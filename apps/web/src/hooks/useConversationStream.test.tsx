import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  createStreamServiceStub,
} from '@/test/conversationStreamTestUtils'
import type { ConversationStreamClient } from './useConversationStream'
import { useConversationStream } from './useConversationStream'
import type {
  ConversationSnapshot,
  ConversationStreamEvent,
} from '@/types/streaming'

function toIso(timestamp: string): string {
  return new Date(timestamp).toISOString()
}

interface HarnessProps {
  client: ConversationStreamClient
}

function ConversationHarness({ client }: HarnessProps) {
  const { status, messages } = useConversationStream({
    conversationId: 42,
    userId: 7,
    client,
  })

  if (status === 'loading') {
    return <div data-testid="status">loading</div>
  }

  return (
    <div>
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
})
