import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Block } from '@/types/conversation'
import { BlockRenderer } from './BlockRenderer'

// Mock ToolCallDisplay component
vi.mock('./ToolCallDisplay', () => ({
  ToolCallDisplay: ({ toolCall }: { toolCall: any }) => (
    <div data-testid="tool-call-display">
      Tool: {toolCall.name} - Status: {toolCall.status}
    </div>
  ),
}))

describe('BlockRenderer', () => {
  describe('text blocks', () => {
    it('renders plain text', () => {
      const block: Block = {
        id: '1',
        type: 'text',
        content: 'Hello world',
      }

      render(<BlockRenderer block={block} />)

      expect(screen.getByText('Hello world')).toBeInTheDocument()
    })

    it('renders markdown formatting', () => {
      const block: Block = {
        id: '1',
        type: 'text',
        content: '# Heading\n\n**Bold text** and *italic text*',
      }

      render(<BlockRenderer block={block} />)

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Heading'
      )
      expect(screen.getByText('Bold text')).toBeInTheDocument()
      expect(screen.getByText('italic text')).toBeInTheDocument()
    })

    it('renders code blocks', () => {
      const block: Block = {
        id: '1',
        type: 'text',
        content: '```javascript\nconsole.log("hello")\n```',
      }

      render(<BlockRenderer block={block} />)

      // Check that a code block is rendered (syntax highlighting breaks text into spans)
      const codeElement = document.querySelector('code.language-javascript')
      expect(codeElement).toBeInTheDocument()
      expect(codeElement?.textContent).toContain('console')
      expect(codeElement?.textContent).toContain('log')
      expect(codeElement?.textContent).toContain('"hello"')
    })

    it('renders inline code', () => {
      const block: Block = {
        id: '1',
        type: 'text',
        content: 'Use the `console.log()` function',
      }

      render(<BlockRenderer block={block} />)

      expect(screen.getByText('console.log()')).toBeInTheDocument()
    })

    it('renders links', () => {
      const block: Block = {
        id: '1',
        type: 'text',
        content: '[Link text](https://example.com)',
      }

      render(<BlockRenderer block={block} />)

      const link = screen.getByRole('link', { name: 'Link text' })
      expect(link).toHaveAttribute('href', 'https://example.com')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('renders lists', () => {
      const block: Block = {
        id: '1',
        type: 'text',
        content: '- Item 1\n- Item 2\n\n1. Numbered item',
      }

      render(<BlockRenderer block={block} />)

      expect(screen.getByText('Item 1')).toBeInTheDocument()
      expect(screen.getByText('Item 2')).toBeInTheDocument()
      expect(screen.getByText('Numbered item')).toBeInTheDocument()
    })
  })

  describe('tool blocks', () => {
    it('renders tool_use blocks', () => {
      const block: Block = {
        id: '1',
        type: 'tool_use',
        content: '',
        metadata: {
          toolName: 'bash',
          input: { command: 'ls' },
        },
      }

      render(<BlockRenderer block={block} />)

      expect(screen.getByTestId('tool-call-display')).toHaveTextContent(
        'Tool: bash - Status: pending'
      )
    })

    it('renders tool_result blocks', () => {
      const block: Block = {
        id: '1',
        type: 'tool_result',
        content: '',
        metadata: {
          toolName: 'bash',
          toolUseId: 'tool-1',
          output: 'file1.txt\nfile2.txt',
        },
      }

      render(<BlockRenderer block={block} />)

      expect(screen.getByTestId('tool-call-display')).toHaveTextContent(
        'Tool: bash - Status: completed'
      )
    })

    it('handles missing metadata gracefully', () => {
      const block: Block = {
        id: '1',
        type: 'tool_use',
        content: '',
      }

      render(<BlockRenderer block={block} />)

      expect(screen.getByTestId('tool-call-display')).toHaveTextContent(
        'Tool: unknown - Status: pending'
      )
    })
  })

  describe('thinking blocks', () => {
    it('renders thinking blocks in development', () => {
      // Set NODE_ENV to development
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'

      const block: Block = {
        id: '1',
        type: 'thinking',
        content: 'Analyzing the problem...',
      }

      render(<BlockRenderer block={block} />)

      expect(screen.getByText('[thinking]')).toBeInTheDocument()
      expect(screen.getByText('Analyzing the problem...')).toBeInTheDocument()

      // Restore original env
      process.env.NODE_ENV = originalEnv
    })

    it('hides thinking blocks in production', () => {
      // Set NODE_ENV to production
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      const block: Block = {
        id: '1',
        type: 'thinking',
        content: 'Analyzing the problem...',
      }

      const { container } = render(<BlockRenderer block={block} />)

      expect(container.firstChild).toBeNull()

      // Restore original env
      process.env.NODE_ENV = originalEnv
    })
  })

  describe('unknown blocks', () => {
    it('renders unknown block types', () => {
      const block: Block = {
        id: '1',
        type: 'unknown' as any,
        content: 'Some content',
      }

      render(<BlockRenderer block={block} />)

      expect(
        screen.getByText('[Unknown block type: unknown]')
      ).toBeInTheDocument()
    })
  })

  describe('user styling', () => {
    it('applies user link styling when isUser is true', () => {
      const block: Block = {
        id: '1',
        type: 'text',
        content: '[Link](https://example.com)',
      }

      render(<BlockRenderer block={block} isUser />)

      const link = screen.getByRole('link')
      expect(link).toHaveClass('text-blue-200', 'hover:text-blue-100')
    })

    it('applies default link styling when isUser is false', () => {
      const block: Block = {
        id: '1',
        type: 'text',
        content: '[Link](https://example.com)',
      }

      render(<BlockRenderer block={block} isUser={false} />)

      const link = screen.getByRole('link')
      expect(link).toHaveClass('text-blue-600', 'hover:text-blue-700')
    })
  })
})
