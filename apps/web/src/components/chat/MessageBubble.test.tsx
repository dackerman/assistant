import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Message } from '@/types/conversation'
import { MessageBubble } from './MessageBubble'

// Mock BlockRenderer
vi.mock('./BlockRenderer', () => ({
  BlockRenderer: ({ block }: { block: any }) => (
    <div data-testid={`block-${block.id}`}>
      {block.type === 'text' || block.type === 'thinking'
        ? block.content
        : block.type === 'tool_call'
          ? `Tool: ${block.toolName || 'unknown'}`
          : block.content}
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
            type: 'tool_call',
            content: 'file1.txt\nfile2.txt\n',
            toolName: 'bash',
            toolUseId: 'tool-1',
            toolCallId: 'call-1',
            input: { command: 'ls' },
            output: 'file1.txt\nfile2.txt\n',
            error: '',
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
            type: 'tool_call',
            content: '/home/user',
            toolName: 'bash',
            toolUseId: 'tool-1',
            toolCallId: 'call-1',
            input: { command: 'pwd' },
            output: '/home/user',
            error: '',
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
      expect(blocks).toHaveLength(3)

      // Verify order by checking the rendered content
      expect(blocks[0]).toHaveTextContent('Step 1: Analyze the problem')
      expect(blocks[1]).toHaveTextContent('Tool: bash')
      expect(blocks[2]).toHaveTextContent(
        'Step 2: Now I know the current directory'
      )
    })

    it('renders empty blocks array correctly', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'assistant',
        blocks: [], // Empty blocks array
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      // Should render empty blocks container
      const contentDiv = document.querySelector('.blocks-container')
      expect(contentDiv).toBeInTheDocument()
      expect(contentDiv?.children).toHaveLength(0)
      expect(screen.queryByTestId(/^block-/)).not.toBeInTheDocument()
    })

    it('renders messages with text blocks', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'assistant',
        blocks: [
          {
            id: 'block-1',
            type: 'text',
            content: 'This is text content',
          },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      // Should render text block
      expect(screen.getByText('This is text content')).toBeInTheDocument()
      expect(screen.getByTestId('block-block-1')).toBeInTheDocument()
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

  describe('tool call rendering', () => {
    it('renders tool call blocks', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'assistant',
        blocks: [
          {
            id: 'block-1',
            type: 'tool_call',
            content: 'README.md\npackage.json\n',
            toolName: 'bash',
            toolUseId: 'tool-1',
            toolCallId: 'call-1',
            input: { command: 'ls' },
            output: 'README.md\npackage.json\n',
            error: '',
          },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      // Should render tool call block
      expect(screen.getByTestId('block-block-1')).toBeInTheDocument()
      expect(screen.getByText('Tool: bash')).toBeInTheDocument()
    })
  })

  describe('mixed scenarios', () => {
    it('renders multiple blocks correctly', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'assistant',
        blocks: [
          {
            id: 'block-1',
            type: 'text',
            content: 'First block content',
          },
          {
            id: 'block-2',
            type: 'text',
            content: 'Second block content',
          },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      }

      render(<MessageBubble message={message} />)

      // Should render both blocks
      expect(screen.getByTestId('block-block-1')).toHaveTextContent(
        'First block content'
      )
      expect(screen.getByTestId('block-block-2')).toHaveTextContent(
        'Second block content'
      )
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
            type: 'tool_call',
            content: 'results',
            toolName: 'search',
            toolUseId: 'tool-1',
            toolCallId: 'call-1',
            input: { query: 'test' },
            output: 'results',
            error: '',
          },
          {
            id: 'block-4',
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
        'Internal reasoning'
      ) // thinking blocks show their content
      expect(screen.getByTestId('block-block-3')).toHaveTextContent(
        'Tool: search'
      )
      expect(screen.getByTestId('block-block-4')).toHaveTextContent(
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
