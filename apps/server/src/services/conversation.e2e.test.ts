import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { toolCalls, users } from '../db/schema'
import {
  createConversationServiceFixture,
  expectMessagesState,
} from '../test/conversationServiceFixture'
import { setupTestDatabase, teardownTestDatabase, testDb } from '../test/setup'
import {
  ConversationService,
  type ConversationStreamEvent,
} from './conversationService'

const truncateAll = async () => {
  await testDb.execute(sql`
    TRUNCATE TABLE tool_calls RESTART IDENTITY CASCADE;
    TRUNCATE TABLE prompt_events RESTART IDENTITY CASCADE;
    TRUNCATE TABLE prompts RESTART IDENTITY CASCADE;
    TRUNCATE TABLE blocks RESTART IDENTITY CASCADE;
    TRUNCATE TABLE messages RESTART IDENTITY CASCADE;
    TRUNCATE TABLE conversations RESTART IDENTITY CASCADE;
    TRUNCATE TABLE users RESTART IDENTITY CASCADE;
  `)
}

const waitFor = async (
  predicate: () => Promise<boolean>,
  attempts = 20,
  delayMs = 25
) => {
  for (let i = 0; i < attempts; i++) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
  throw new Error('Condition not met within timeout')
}

describe('ConversationService – createConversation', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  afterAll(async () => {
    await teardownTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  it('creates a conversation row for the provided user', async () => {
    const service = new ConversationService(testDb)
    const [user] = await testDb
      .insert(users)
      .values({ email: 'creator@example.com' })
      .returning()

    expect(user).toBeDefined()

    const title = 'Project Sync'
    const conversationId = await service.createConversation(user.id, title)

    const state = await service.getConversation(conversationId, user.id)
    expect(state).not.toBeNull()
    expect(state?.conversation.id).toBe(conversationId)
    expect(state?.conversation.userId).toBe(user.id)
    expect(state?.conversation.title).toBe(title)
    expect(
      new Date(state?.conversation.createdAt ?? 0).getTime()
    ).toBeGreaterThan(0)
    expect(
      new Date(state?.conversation.updatedAt ?? 0).getTime()
    ).toBeGreaterThan(0)
    expectMessagesState(state?.messages, [])
  })

  it('queues the first user message and starts streaming', async () => {
    const streams = [
      [
        {
          type: 'message_start',
          message: {
            id: 'msg_test',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4-20250514',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hi!' },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 1 },
        },
        { type: 'message_stop' },
      ],
    ]

    const fixture = createConversationServiceFixture(testDb)
    for (const events of streams) {
      fixture.enqueueStream(events)
    }

    const [user] = await fixture.insertUser('queue@example.com')
    const conversationId = await fixture.conversationService.createConversation(
      user.id,
      'Queue Test'
    )

    await fixture.conversationService.queueMessage(
      conversationId,
      'Hello there'
    )

    const state = await fixture.conversationService.getConversation(
      conversationId,
      user.id
    )

    expect(state).not.toBeNull()
    expectMessagesState(state?.messages, [
      {
        role: 'user',
        status: 'completed',
        blocks: [{ type: 'text', content: 'Hello there' }],
      },
      {
        role: 'assistant',
        status: 'completed',
        blocks: [{ type: 'text', content: 'Hi!' }],
      },
    ])

    expect(state?.conversation.activePromptId).toBeNull()

    const activePrompt =
      await fixture.conversationService.getActivePrompt(conversationId)
    expect(activePrompt).toBeNull()
  })

  it('streams conversation events across prompts', async () => {
    const fixture = createConversationServiceFixture(testDb)
    const firstToolStream = fixture.enqueueStream([], {
      autoFinish: false,
    })
    const firstTextStream = fixture.enqueueStream([], {
      autoFinish: false,
    })
    let secondToolStream: ReturnType<typeof fixture.enqueueStream> | null = null
    let secondTextStream: ReturnType<typeof fixture.enqueueStream> | null = null

    const [user] = await fixture.insertUser('stream@example.com')
    const conversationId = await fixture.conversationService.createConversation(
      user.id,
      'Streaming'
    )

    const stream = await fixture.conversationService.streamConversation(
      conversationId,
      user.id
    )

    expect(stream).not.toBeNull()
    if (!stream) return

    expect(stream.snapshot.conversation.id).toBe(conversationId)
    expect(stream.snapshot.messages).toHaveLength(0)

    const iterator = stream.events[Symbol.asyncIterator]()
    const events: ConversationStreamEvent[] = []

    const nextEvent = async () => {
      const { value, done } = await iterator.next()
      expect(done).toBe(false)
      expect(value).toBeDefined()
      events.push(value)
      return value as ConversationStreamEvent
    }

    const expectEvent = async <T extends ConversationStreamEvent['type']>(
      type: T,
      assert?:
        | Extract<ConversationStreamEvent, { type: T }>
        | ((event: Extract<ConversationStreamEvent, { type: T }>) => void)
    ) => {
      const typed = await nextEvent()
      expect(typed.type).toBe(type)
      if (typeof assert === 'function') {
        assert(typed as Extract<ConversationStreamEvent, { type: T }>)
      } else if (assert) {
        expect(assert).toEqual(typed)
      }
      return typed as Extract<ConversationStreamEvent, { type: T }>
    }

    const waitForEvent = async <T extends ConversationStreamEvent['type']>(
      type: T,
      assert?:
        | Extract<ConversationStreamEvent, { type: T }>
        | ((event: Extract<ConversationStreamEvent, { type: T }>) => void)
    ) => {
      while (true) {
        const event = await nextEvent()
        if (event.type !== type) {
          continue
        }
        if (typeof assert === 'function') {
          assert(event as Extract<ConversationStreamEvent, { type: T }>)
        } else if (assert) {
          expect(assert).toEqual(event)
        }
        return event as Extract<ConversationStreamEvent, { type: T }>
      }
    }

    let firstQueuePromise: Promise<number> | null = null
    let secondQueuePromise: Promise<number> | null = null

    try {
      // First prompt
      firstQueuePromise = fixture.conversationService.queueMessage(
        conversationId,
        "What's the weather in Tokyo?"
      )

      await expectEvent('message-created', event => {
        expect(event.message.role).toBe('user')
        expect(event.message.content).toBe("What's the weather in Tokyo?")
      })

      await expectEvent('message-updated', event => {
        expect(event.message.role).toBe('user')
        expect(event.message.status).toBe('processing')
      })

      await expectEvent('message-created', event => {
        expect(event.message.role).toBe('assistant')
        expect(event.message.status).toBe('processing')
      })

      await expectEvent('message-updated', event => {
        expect(event.message.role).toBe('user')
        expect(event.message.status).toBe('completed')
      })

      const firstPromptStarted = await expectEvent('prompt-started')

      firstToolStream.push({
        type: 'message_start',
        message: {
          id: 'prompt-1',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-20250514',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      })
      firstToolStream.push({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'fake-tool-call-1',
          name: 'bash',
        },
      })

      const firstToolBlockStart = await expectEvent('block-start', event => {
        expect(event.promptId).toBe(firstPromptStarted.prompt.id)
        expect(event.blockType).toBe('tool_use')
      })

      await expectEvent('block-delta', event => {
        expect(event.promptId).toBe(firstPromptStarted.prompt.id)
        expect(event.blockId).toBe(firstToolBlockStart.blockId)
        expect(event.content).toBe('Using bash tool...')
      })

      firstToolStream.push({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"command":"weather --city tokyo',
        },
      })
      firstToolStream.push({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"}' },
      })
      firstToolStream.push({ type: 'content_block_stop', index: 0 })

      await expectEvent('block-end', event => {
        expect(event.blockId).toBe(firstToolBlockStart.blockId)
      })

      const firstToolStarted = await expectEvent('tool-call-started', event => {
        expect(event.toolCall.promptId).toBe(firstPromptStarted.prompt.id)
        expect(event.input.command).toBe('weather --city tokyo')
      })

      for (let i = 0; i < 3; i++) {
        await waitForEvent('tool-call-progress', event => {
          expect(event.toolCallId).toBe(firstToolStarted.toolCall.id)
        })
      }

      await waitForEvent('tool-call-completed', event => {
        expect(event.toolCall.id).toBe(firstToolStarted.toolCall.id)
        expect(event.toolCall.output).toBe('testing tool output.\nthis is just a test!')
      })

      await waitForEvent('block-end', event => {
        expect(event.blockId).toBe(firstToolStarted.toolCall.blockId)
      })

      firstToolStream.push({
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 0 },
      })
      firstToolStream.push({ type: 'message_stop' })
      firstToolStream.finish()

      firstTextStream.push({
        type: 'message_start',
        message: {
          id: 'prompt-1-cont',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-20250514',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      })
      firstTextStream.push({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      })

      const firstTextBlockStart = await expectEvent('block-start', event => {
        expect(event.promptId).toBe(firstPromptStarted.prompt.id)
        expect(event.blockType).toBe('text')
      })

      firstTextStream.push({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: 'The weather report is above. ',
        },
      })

      await expectEvent('block-delta', event => {
        expect(event.blockId).toBe(firstTextBlockStart.blockId)
        expect(event.content).toBe('The weather report is above. ')
      })

      const midConnectingStream =
        await fixture.conversationService.streamConversation(
          conversationId,
          user.id
        )
      expect(normalizeData(midConnectingStream?.snapshot)).toMatchSnapshot(
        'mid connecting snapshot'
      )
      midConnectingStream?.events.return?.(undefined)

      const replayPrompt = await nextEvent()
      expect(replayPrompt.type).toBe('prompt-started')
      expect(replayPrompt.prompt.id).toBe(firstPromptStarted.prompt.id)

      let replayDeltaReceived = false
      while (!replayDeltaReceived) {
        const replayEvent = await nextEvent()
        if (replayEvent.type === 'block-delta') {
          expect(replayEvent.blockId).toBe(firstTextBlockStart.blockId)
          expect(replayEvent.content).toBe('The weather report is above. ')
          replayDeltaReceived = true
        }
      }

      firstTextStream.push({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: 'Let me know if you need more details.',
        },
      })

      await expectEvent('block-delta', event => {
        expect(event.blockId).toBe(firstTextBlockStart.blockId)
        expect(event.content).toBe('Let me know if you need more details.')
      })

      firstTextStream.push({ type: 'content_block_stop', index: 0 })

      await expectEvent('block-end', event => {
        expect(event.blockId).toBe(firstTextBlockStart.blockId)
      })

      firstTextStream.push({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 2 },
      })
      firstTextStream.push({ type: 'message_stop' })
      firstTextStream.finish()

      await expectEvent('prompt-completed', event => {
        expect(event.prompt.id).toBe(firstPromptStarted.prompt.id)
      })
      const postPromptEvent = await nextEvent()
      if (postPromptEvent.type === 'prompt-completed') {
        expect(postPromptEvent.prompt.id).toBe(firstPromptStarted.prompt.id)
        const afterReplay = await nextEvent()
        expect(afterReplay.type).toBe('message-updated')
        expect(afterReplay.message.role).toBe('assistant')
        expect(afterReplay.message.status).toBe('completed')
      } else {
        expect(postPromptEvent.type).toBe('message-updated')
        expect(postPromptEvent.message.role).toBe('assistant')
        expect(postPromptEvent.message.status).toBe('completed')
      }
      await firstQueuePromise

      // Second prompt
      secondToolStream = fixture.enqueueStream([], { autoFinish: false })
      secondTextStream = fixture.enqueueStream([], { autoFinish: false })
      secondQueuePromise = fixture.conversationService.queueMessage(
        conversationId,
        'Tell me a quick joke'
      )

      await waitForEvent('message-created', event => {
        expect(event.message.role).toBe('user')
        expect(event.message.content).toBe('Tell me a quick joke')
      })
      await waitForEvent('message-updated', event => {
        expect(event.message.role).toBe('user')
        expect(event.message.status).toBe('processing')
      })
      await waitForEvent('message-created', event => {
        expect(event.message.role).toBe('assistant')
        expect(event.message.status).toBe('processing')
      })
      await waitForEvent('message-updated', event => {
        expect(event.message.role).toBe('user')
        expect(event.message.status).toBe('completed')
      })

      const secondPromptStarted = await waitForEvent('prompt-started')

      secondToolStream.push({
        type: 'message_start',
        message: {
          id: 'prompt-2',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-20250514',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      })
      secondToolStream.push({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'fake-tool-call-2',
          name: 'bash',
        },
      })

      const secondToolBlockStart = await waitForEvent('block-start', event => {
        expect(event.promptId).toBe(secondPromptStarted.prompt.id)
        expect(event.blockType).toBe('tool_use')
      })

      await waitForEvent('block-delta', event => {
        expect(event.blockId).toBe(secondToolBlockStart.blockId)
        expect(event.content).toBe('Using bash tool...')
      })

      secondToolStream.push({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"command":"tell me a joke',
        },
      })
      secondToolStream.push({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"}' },
      })
      secondToolStream.push({ type: 'content_block_stop', index: 0 })

      await waitForEvent('block-end', event => {
        expect(event.blockId).toBe(secondToolBlockStart.blockId)
      })

      const secondToolStarted = await waitForEvent(
        'tool-call-started',
        event => {
          expect(event.toolCall.promptId).toBe(secondPromptStarted.prompt.id)
          expect(event.input.command).toBe('tell me a joke')
        }
      )

      for (let i = 0; i < 3; i++) {
        await waitForEvent('tool-call-progress', event => {
          expect(event.toolCallId).toBe(secondToolStarted.toolCall.id)
        })
      }

      await waitForEvent('tool-call-completed', event => {
        expect(event.toolCall.id).toBe(secondToolStarted.toolCall.id)
        expect(event.toolCall.output).toBe('testing tool output.\nthis is just a test!')
      })

      await waitForEvent('block-end', event => {
        expect(event.blockId).toBe(secondToolStarted.toolCall.blockId)
      })

      secondToolStream.push({
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 0 },
      })
      secondToolStream.push({ type: 'message_stop' })
      secondToolStream.finish()

      secondTextStream.push({
        type: 'message_start',
        message: {
          id: 'prompt-2-cont',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-20250514',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      })
      secondTextStream.push({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      })

      const secondTextBlockStart = await waitForEvent('block-start', event => {
        expect(event.promptId).toBe(secondPromptStarted.prompt.id)
        expect(event.blockType).toBe('text')
      })

      secondTextStream.push({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: "Here's something funny: Why did the scarecrow win an award? ",
        },
      })

      await waitForEvent('block-delta', event => {
        expect(event.blockId).toBe(secondTextBlockStart.blockId)
        expect(event.content).toBe(
          "Here's something funny: Why did the scarecrow win an award? "
        )
      })

      secondTextStream.push({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: 'Because he was outstanding in his field.',
        },
      })

      await waitForEvent('block-delta', event => {
        expect(event.blockId).toBe(secondTextBlockStart.blockId)
        expect(event.content).toBe('Because he was outstanding in his field.')
      })

      secondTextStream.push({ type: 'content_block_stop', index: 0 })

      await waitForEvent('block-end', event => {
        expect(event.blockId).toBe(secondTextBlockStart.blockId)
      })

      secondTextStream.push({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 2 },
      })
      secondTextStream.push({ type: 'message_stop' })
      secondTextStream.finish()

      await waitForEvent('prompt-completed', event => {
        expect(event.prompt.id).toBe(secondPromptStarted.prompt.id)
      })
      await waitForEvent('message-updated', event => {
        expect(event.message.role).toBe('assistant')
        expect(event.message.status).toBe('completed')
      })
      await secondQueuePromise

      const recordedToolCalls = await fixture.db
        .select()
        .from(toolCalls)
        .orderBy(toolCalls.id)

      expect(recordedToolCalls).toHaveLength(2)
      expect(recordedToolCalls.map(call => call.state)).toEqual([
        'completed',
        'completed',
      ])
      expect(recordedToolCalls.map(call => call.output)).toEqual([
        'testing tool output.\nthis is just a test!',
        'testing tool output.\nthis is just a test!',
      ])

      const progressChunks = events
        .filter(event => event.type === 'tool-call-progress')
        .map(event => (event as any).output)

      expect(progressChunks).toEqual([
        'testing tool output.\n',
        'this is just ',
        'a test!',
        'testing tool output.\n',
        'this is just ',
        'a test!',
      ])

      const blockDeltas = events
        .filter(event => event.type === 'block-delta')
        .map(event => 'content' in event && event.content)

      expect(blockDeltas).toEqual([
        'Using bash tool...',
        'The weather report is above. ',
        'The weather report is above. ',
        'Let me know if you need more details.',
        'Using bash tool...',
        "Here's something funny: Why did the scarecrow win an award? ",
        'Because he was outstanding in his field.',
      ])

      expect(
        events.filter(event => event.type === 'tool-call-started').length
      ).toBe(2)
      expect(
        events.filter(event => event.type === 'tool-call-completed').length
      ).toBe(2)
      expect(
        events.filter(event => event.type === 'tool-call-progress').length
      ).toBe(6)

      expect(
        events.filter(event => event.type === 'prompt-completed').length
      ).toBeGreaterThanOrEqual(2)

      expect(
        events.filter(
          event =>
            event.type === 'message-created' && event.message.role === 'user'
        ).length
      ).toBeGreaterThanOrEqual(2)
      expect(
        events.filter(
          event =>
            event.type === 'message-created' &&
            event.message.role === 'assistant'
        ).length
      ).toBeGreaterThanOrEqual(2)

      expect(normalizeData(events)).toMatchSnapshot('all events')

      // If a user connects to the stream after the conversation is complete, they should see the final state of the conversation
      const lateConnectingStream =
        await fixture.conversationService.streamConversation(
          conversationId,
          user.id
        )

      expect(normalizeData(lateConnectingStream?.snapshot)).toMatchSnapshot(
        'final snapshot'
      )
      lateConnectingStream?.events.return?.(undefined)
    } finally {
      firstToolStream.finish()
      firstTextStream.finish()
      secondToolStream?.finish()
      secondTextStream?.finish()
      await firstQueuePromise?.catch(() => undefined)
      await secondQueuePromise?.catch(() => undefined)
      await iterator.return?.(undefined)
    }
  })
})

/**
 * Recursively normalizes data for snapshots. Dates become "Any<Date>" and
 * object keys are ordered using the custom precedence rules:
 *   1) `id`
 *   2) `type`
 *   3) other keys ending in `Id` (alphabetical)
 *   4) remaining keys alphabetically, with date-like keys (ending in `At` or
 *      `Date`) sorted last.
 */
function normalizeData(obj: unknown): unknown {
  if (obj instanceof Date) {
    return 'Any<Date>'
  }
  if (Array.isArray(obj)) {
    return obj.map(item => normalizeData(item))
  }
  if (typeof obj === 'object' && obj !== null) {
    const entries = Object.entries(obj).map(([key, value]) => [
      key,
      normalizeData(value),
    ]) as Array<[string, unknown]>

    const rankKey = (key: string) => {
      if (key === 'id') return 0
      if (key === 'type') return 1
      if (key.endsWith('Id') && key !== 'id') return 2
      if (/(At|Date)$/i.test(key)) return 4
      return 3
    }

    entries.sort((a, b) => {
      const rankDiff = rankKey(a[0]) - rankKey(b[0])
      if (rankDiff !== 0) return rankDiff
      return a[0].localeCompare(b[0])
    })

    return Object.fromEntries(entries)
  }
  return obj
}
