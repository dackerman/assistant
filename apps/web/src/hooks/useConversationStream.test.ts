import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useConversationStream } from './useConversationStream'
import { createStreamServiceStub } from '@/test/conversationStreamTestUtils'
import type { ConversationStreamEvent } from '@/types/streaming'

describe('useConversationStream', () => {
  const mockClient = {
    streamConversation: vi.fn(),
  }

  it('should handle a simple text conversation', async () => {
    const snapshot = {
      conversation: {
        id: 1,
        title: 'Test Conversation',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      messages: [
        {
          id: 1,
          role: 'user',
          content: 'Hello',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          blocks: [
            {
              id: 1,
              type: 'text',
              content: 'Hello',
              order: 0,
            },
          ],
        },
      ],
    }

    const { payload, emit } = createStreamServiceStub(snapshot)
    mockClient.streamConversation.mockResolvedValue(payload)

    const { result } = renderHook(() =>
      useConversationStream({
        conversationId: 1,
        userId: 1,
        client: mockClient,
      })
    )

    // Initially loading
    expect(result.current.status).toBe('loading')
    expect(result.current.messages).toEqual([])

    // Wait for initial snapshot to load
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    // Should have the user message from snapshot
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]).toEqual({
      id: '1',
      type: 'user',
      blocks: [
        {
          id: '1',
          type: 'text',
          content: 'Hello',
        },
      ],
      timestamp: '2024-01-01T00:00:00Z',
    })

    // Start streaming events
    await emit({
      type: 'message-created',
      message: {
        id: 2,
        role: 'assistant',
        content: '',
        status: 'processing',
        createdAt: '2024-01-01T00:01:00Z',
        updatedAt: '2024-01-01T00:01:00Z',
        blocks: [],
      },
    } as ConversationStreamEvent)

    // Should now have 2 messages
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2)
    })

    await emit({
      type: 'block-start',
      messageId: 2,
      blockId: 2,
      blockType: 'text',
    } as ConversationStreamEvent)

    await emit({
      type: 'block-delta',
      messageId: 2,
      blockId: 2,
      content: 'Hi',
    } as ConversationStreamEvent)

    await emit({
      type: 'block-delta',
      messageId: 2,
      blockId: 2,
      content: ' there!',
    } as ConversationStreamEvent)

    await emit({
      type: 'block-end',
      messageId: 2,
      blockId: 2,
    } as ConversationStreamEvent)

    await emit({
      type: 'message-updated',
      message: {
        id: 2,
        role: 'assistant',
        content: 'Hi there!',
        status: 'completed',
        createdAt: '2024-01-01T00:01:00Z',
        updatedAt: '2024-01-01T00:01:30Z',
        blocks: [
          {
            id: 2,
            type: 'text',
            content: 'Hi there!',
            order: 0,
          },
        ],
      },
    } as ConversationStreamEvent)

    // Should have both messages with the assistant message built up from streaming
    const assistantMessage = result.current.messages[1]
    expect(assistantMessage).toEqual({
      id: '2',
      type: 'assistant',
      blocks: [
        {
          id: '2',
          type: 'text',
          content: 'Hi there!',
        },
      ],
      timestamp: '2024-01-01T00:01:00Z',
    })

    expect(result.current.isStreaming).toBe(false)
  })

  it('should handle tool call blocks', async () => {
    const snapshot = {
      conversation: {
        id: 1,
        title: 'Tool Test',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      messages: [],
    }

    const { payload, emit } = createStreamServiceStub(snapshot)
    mockClient.streamConversation.mockResolvedValue(payload)

    const { result } = renderHook(() =>
      useConversationStream({
        conversationId: 1,
        userId: 1,
        client: mockClient,
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    // Should start with empty messages since snapshot has no messages
    expect(result.current.messages).toHaveLength(0)

    // Create assistant message
    await emit({
      type: 'message-created',
      message: {
        id: 1,
        role: 'assistant',
        content: '',
        status: 'processing',
        promptId: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        blocks: [],
      },
    } as ConversationStreamEvent)

    // Start tool block
    await emit({
      type: 'block-start',
      messageId: 1,
      blockId: 1,
      blockType: 'tool_use',
    } as ConversationStreamEvent)

    // Tool call started
    await emit({
      type: 'tool-call-started',
      toolCall: {
        id: 1,
        promptId: 1,
        blockId: 1,
        name: 'bash',
        input: { command: 'echo "hello"' },
        state: 'executing',
        apiToolCallId: 'tool_123',
      },
    } as ConversationStreamEvent)

    // Tool progress
    await emit({
      type: 'tool-call-progress',
      toolCallId: 1,
      output: 'hello\n',
    } as ConversationStreamEvent)

    // Tool completed
    await emit({
      type: 'tool-call-completed',
      toolCall: {
        id: 1,
        promptId: 1,
        blockId: 1,
        name: 'bash',
        output: 'hello\n',
        state: 'completed',
      },
    } as ConversationStreamEvent)

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1)
    })

    const message = result.current.messages[0]
    expect(message.blocks).toHaveLength(1)

    const toolBlock = message.blocks[0]
    expect(toolBlock.type).toBe('tool_call')
    if (toolBlock.type === 'tool_call') {
      expect(toolBlock.toolName).toBe('bash')
      expect(toolBlock.input).toEqual({ command: 'echo "hello"' })
      expect(toolBlock.output).toBe('hello\n')
      expect(toolBlock.content).toBe('hello\n')
    }
  })

  it('should handle missing conversationId gracefully', () => {
    const { result } = renderHook(() =>
      useConversationStream({
        conversationId: null,
        userId: 1,
        client: mockClient,
      })
    )

    expect(result.current.status).toBe('idle')
    expect(result.current.messages).toEqual([])
    expect(result.current.conversation).toBeNull()
    expect(result.current.error).toBeNull()
  })
})