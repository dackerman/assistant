import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Message } from '@/types/conversation'
import { MessageBubble } from './MessageBubble'

// Mock BlockRenderer
vi.mock('./BlockRenderer', () => ({
  BlockRenderer: ({ block }: { block: any }) => (
    <div data-testid={`block-${block.id}`}>
      {block.type === 'text'
        ? block.content
        : `Tool: ${block.metadata?.toolName || 'unknown'}`}
    </div>
  ),
}))

// Mock ToolCallDisplay
vi.mock('./ToolCallDisplay', () => ({
  ToolCallDisplay: ({ toolCall }: { toolCall: any }) => (
    <div data-testid={`tool-call-${toolCall.id}`}>
      Tool Call: {toolCall.name}
    </div>
  ),
}))

describe('MessageBubble', () => {
  describe('block rendering', () => {
    it('renders blocks when message has blocks array', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'assistant',
        blocks: [
          {
            id: 'block-1',
            type: 'text',
            content: 'First text block',
          },
          {
            id: 'block-2',
            type: 'tool_use',
            content: '',
            metadata: {
              toolName: 'bash',
              input: { command: 'ls' },
            },
          },
          {
            id: 'block-3',
            type: 'text',
            content: 'Text after tool call',
          },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      // Should render blocks, not legacy content
      expect(screen.getByTestId('block-block-1')).toHaveTextContent(
        'First text block'
      )
      expect(screen.getByTestId('block-block-2')).toHaveTextContent(
        'Tool: bash'
      )
      expect(screen.getByTestId('block-block-3')).toHaveTextContent(
        'Text after tool call'
      )

      // Should not render legacy content
      expect(
        screen.queryByText(/First text block.*Text after tool call/)
      ).not.toBeInTheDocument()
    })

    it('renders blocks in correct order', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'assistant',
        blocks: [
          {
            id: 'block-1',
            type: 'text',
            content: 'Step 1: Analyze the problem',
          },
          {
            id: 'block-2',
            type: 'tool_use',
            content: '',
            metadata: {
              toolName: 'bash',
              input: { command: 'pwd' },
            },
          },
          {
            id: 'block-3',
            type: 'tool_result',
            content: '',
            metadata: {
              toolName: 'bash',
              toolUseId: 'tool-1',
              output: '/home/user',
            },
          },
          {
            id: 'block-4',
            type: 'text',
            content: 'Step 2: Now I know the current directory',
          },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      const blocks = screen.getAllByTestId(/^block-block-\d+$/)
      expect(blocks).toHaveLength(4)

      // Verify order by checking the rendered content
      expect(blocks[0]).toHaveTextContent('Step 1: Analyze the problem')
      expect(blocks[1]).toHaveTextContent('Tool: bash')
      expect(blocks[2]).toHaveTextContent('Tool: bash') // tool_result also shows tool name
      expect(blocks[3]).toHaveTextContent(
        'Step 2: Now I know the current directory'
      )
    })

    it('renders empty blocks array as legacy content', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'assistant',
        blocks: [], // Empty blocks array
        content: 'This is legacy content',
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      // Should fall back to legacy content rendering
      expect(screen.getByText('This is legacy content')).toBeInTheDocument()
      expect(screen.queryByTestId(/^block-/)).not.toBeInTheDocument()
    })

    it('renders undefined blocks as legacy content', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'assistant',
        blocks: [],
        content: 'This is legacy content',
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      // Should fall back to legacy content rendering
      expect(screen.getByText('This is legacy content')).toBeInTheDocument()
      expect(screen.queryByTestId(/^block-/)).not.toBeInTheDocument()
    })

    it('renders empty content when no blocks or content', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'assistant',
        blocks: [],
        // content is undefined
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      // Should render nothing in the content area
      expect(screen.queryByTestId(/^block-/)).not.toBeInTheDocument()
      // The message-content div should exist but be empty
      const contentDiv = document.querySelector('.message-content')
      expect(contentDiv).toBeInTheDocument()
      expect(contentDiv?.textContent?.trim()).toBe('')
    })
  })

  describe('legacy content rendering', () => {
    it('renders legacy content when no blocks', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'assistant',
        blocks: [],
        content: 'This is **markdown** content with `code`',
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      // Should render markdown content
      expect(screen.getByText(/This is/)).toBeInTheDocument()
      expect(screen.queryByTestId(/^block-/)).not.toBeInTheDocument()
    })

    it('renders legacy tool calls when no blocks', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'assistant',
        blocks: [],
        content: 'Running a command',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'bash',
            parameters: { command: 'ls' },
            status: 'completed',
            startTime: '2024-01-01T00:00:00Z',
            endTime: '2024-01-01T00:00:01Z',
          },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      // Should render legacy tool calls
      expect(screen.getByTestId('tool-call-tool-1')).toHaveTextContent(
        'Tool Call: bash'
      )
    })
  })

  describe('mixed scenarios', () => {
    it('renders blocks even when legacy content exists', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'assistant',
        blocks: [
          {
            id: 'block-1',
            type: 'text',
            content: 'Block content',
          },
        ],
        content: 'Legacy content (should not be rendered)', // This should be ignored
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      // Should render blocks, not legacy content
      expect(screen.getByTestId('block-block-1')).toHaveTextContent(
        'Block content'
      )
      expect(screen.queryByText('Legacy content')).not.toBeInTheDocument()
    })

    it('handles blocks with different types correctly', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'assistant',
        blocks: [
          {
            id: 'block-1',
            type: 'text',
            content: 'Thinking about this...',
          },
          {
            id: 'block-2',
            type: 'thinking',
            content: 'Internal reasoning',
          },
          {
            id: 'block-3',
            type: 'tool_use',
            content: '',
            metadata: {
              toolName: 'search',
              input: { query: 'test' },
            },
          },
          {
            id: 'block-4',
            type: 'tool_result',
            content: '',
            metadata: {
              toolName: 'search',
              output: 'results',
            },
          },
          {
            id: 'block-5',
            type: 'text',
            content: 'Based on the results...',
          },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      // Should render all blocks
      expect(screen.getByTestId('block-block-1')).toHaveTextContent(
        'Thinking about this...'
      )
      expect(screen.getByTestId('block-block-2')).toHaveTextContent(
        'Tool: unknown'
      ) // thinking blocks show as unknown
      expect(screen.getByTestId('block-block-3')).toHaveTextContent(
        'Tool: search'
      )
      expect(screen.getByTestId('block-block-4')).toHaveTextContent(
        'Tool: search'
      )
      expect(screen.getByTestId('block-block-5')).toHaveTextContent(
        'Based on the results...'
      )
    })
  })

  describe('user messages', () => {
    it('renders user messages with blocks', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'user',
        blocks: [
          {
            id: 'block-1',
            type: 'text',
            content: 'Please help me with this task',
          },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      expect(screen.getByTestId('block-block-1')).toHaveTextContent(
        'Please help me with this task'
      )
      expect(screen.getByText('You')).toBeInTheDocument()
    })
  })
})
