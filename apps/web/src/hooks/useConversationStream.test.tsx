import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createStreamServiceStub } from '@/test/conversationStreamTestUtils'
import {
  proteinEvents,
  proteinSnapshot,
} from '@/test/fixtures/proteinConversation'
import {
  bashEvents,
  bashSnapshot,
} from '@/test/fixtures/bashToolConversation'
import type {
  ConversationSnapshot,
  ConversationStreamEvent,
} from '@/types/streaming'
import type { ConversationStreamClient } from './useConversationStream'
import { useConversationStream } from './useConversationStream'

function toIso(timestamp: string): string {
  return new Date(timestamp).toISOString()
}

interface HarnessProps {
  client: ConversationStreamClient
}

function ConversationHarness({ client }: HarnessProps) {
  const { status, messages, conversation } = useConversationStream({
    conversationId: 42,
    userId: 7,
    client,
  })

  if (status === 'loading') {
    return <div data-testid="status">loading</div>
  }

  return (
    <div>
      <div data-testid="conversation-title">
        {conversation?.title ?? 'Untitled conversation'}
      </div>
      <ul data-testid="messages">
        {messages.map(message => (
          <li
            key={message.id}
            data-testid={`message-${message.id}`}
            data-role={message.type}
          >
            <div data-testid={`message-${message.id}-role`}>{message.type}</div>
            <div data-testid={`message-${message.id}-content`}>
              {message.content}
            </div>
            {message.toolCalls?.map(toolCall => (
              <div
                key={toolCall.id}
                data-testid={`message-${message.id}-toolcall-${toolCall.id}`}
                data-status={toolCall.status}
              >
                {toolCall.name}:{toolCall.status}:{String(toolCall.result ?? '')}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}

describe('useConversationStream', () => {
  it('renders snapshot and streams assistant deltas', async () => {
    const snapshot: ConversationSnapshot = {
      conversation: {
        id: 42,
        title: 'Trip research',
        createdAt: toIso('2024-05-01T12:00:00Z'),
        updatedAt: toIso('2024-05-01T12:00:00Z'),
      },
      messages: [
        {
          id: 1,
          conversationId: 42,
          role: 'user',
          content: "What's the weather in Tokyo?",
          createdAt: toIso('2024-05-01T12:00:00Z'),
          updatedAt: toIso('2024-05-01T12:00:00Z'),
          status: 'completed',
          promptId: null,
          model: null,
          blocks: [
            {
              id: 100,
              messageId: 1,
              type: 'text',
              content: "What's the weather in Tokyo?",
              order: 0,
              metadata: null,
            },
          ],
        },
      ],
    }

    const { payload, emit } = createStreamServiceStub(snapshot)

    const client: ConversationStreamClient = {
      streamConversation: vi.fn(async () => payload),
    }

    render(<ConversationHarness client={client} />)

    expect(await screen.findByTestId('message-1-content')).toHaveTextContent(
      "What's the weather in Tokyo?"
    )

    expect(screen.getByTestId('conversation-title')).toHaveTextContent(
      'Trip research'
    )

    const assistantCreated: ConversationStreamEvent = {
      type: 'message-created',
      message: {
        id: 2,
        conversationId: 42,
        role: 'assistant',
        content: null,
        createdAt: toIso('2024-05-01T12:00:05Z'),
        updatedAt: toIso('2024-05-01T12:00:05Z'),
        status: 'processing',
        promptId: 91,
        model: 'claude-sonnet-4',
        blocks: [],
      },
    }

    await emit(assistantCreated)

    expect(screen.getAllByTestId(/message-\d+-role/)).toHaveLength(2)

    const blockStart: ConversationStreamEvent = {
      type: 'block-start',
      promptId: 91,
      messageId: 2,
      blockId: 200,
      blockType: 'text',
    }

    await emit(blockStart)

    expect(screen.getByTestId('message-2-content')).toHaveTextContent('')

    const firstDelta: ConversationStreamEvent = {
      type: 'block-delta',
      promptId: 91,
      messageId: 2,
      blockId: 200,
      content: 'Here is the latest forecast. ',
    }

    await emit(firstDelta)

    expect(screen.getByTestId('message-2-content')).toHaveTextContent(
      'Here is the latest forecast.'
    )

    const secondDelta: ConversationStreamEvent = {
      type: 'block-delta',
      promptId: 91,
      messageId: 2,
      blockId: 200,
      content: 'Expect light rain this evening.',
    }

    await emit(secondDelta)

    expect(screen.getByTestId('message-2-content')).toHaveTextContent(
      'Here is the latest forecast. Expect light rain this evening.'
    )
  })

  it('preserves user and assistant content for recorded websocket stream', async () => {
    const { payload, emit } = createStreamServiceStub(proteinSnapshot)
    const client: ConversationStreamClient = {
      streamConversation: vi.fn(async () => payload),
    }

    render(<ConversationHarness client={client} />)

    expect(await screen.findByTestId('message-11-content')).toHaveTextContent(
      'hello'
    )

    // After the first message-created event, the user bubble should render text immediately.
    await emit(proteinEvents[0])
    expect(screen.getByTestId('message-15-content')).toHaveTextContent(
      'what is a protein'
    )

    for (const event of proteinEvents.slice(1, proteinEvents.length - 1)) {
      await emit(event)
    }

    await emit(proteinEvents[proteinEvents.length - 1])

    expect(screen.getByTestId('message-15-content')).toHaveTextContent(
      'what is a protein'
    )

    expect(screen.getByTestId('message-16-content')).toHaveTextContent(
      'A protein is a large, complex molecule made up of amino acids'
    )

    expect(screen.getByTestId('conversation-title')).toHaveTextContent(
      'What Is A Protein'
    )
  })

  it('tracks bash tool execution lifecycle', async () => {
    const { payload, emit } = createStreamServiceStub(bashSnapshot)
    const client: ConversationStreamClient = {
      streamConversation: vi.fn(async () => payload),
    }

    render(<ConversationHarness client={client} />)

    for (const event of bashEvents) {
      await emit(event)
    }

    expect(screen.getByTestId('message-301-content')).toHaveTextContent(
      'list the repository files'
    )
    expect(screen.getByTestId('message-302-content')).toHaveTextContent(
      'Here are the repository files:'
    )

    const toolCallElement = screen.getByTestId(
      'message-302-toolcall-901'
    )
    expect(toolCallElement.dataset.status).toBe('completed')
    expect(toolCallElement).toHaveTextContent('bash:completed:README.md')

    expect(screen.getByTestId('conversation-title')).toHaveTextContent(
      'List Repository Files'
    )
  })
})
