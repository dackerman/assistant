import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import type { Block } from '@/types/conversation'
import { ToolCallDisplay } from './ToolCallDisplay'

interface BlockRendererProps {
  block: Block
  isUser?: boolean
  isSystem?: boolean
}

export function BlockRenderer({ block, isUser }: BlockRendererProps) {
  // Render text blocks with markdown
  if (block.type === 'text') {
    return (
      <div className="block-text">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight, rehypeRaw]}
          components={{
            // Code blocks
            code: ({ className, children, ...props }) => {
              const match = /language-(\w+)/.exec(className || '')
              const isInline = !match

              if (isInline) {
                return (
                  <code
                    className="bg-black/15 dark:bg-white/15 rounded px-1.5 py-0.5 text-xs font-mono"
                    {...props}
                  >
                    {children}
                  </code>
                )
              }

              return (
                <code
                  className={`${className || ''} block overflow-x-auto text-xs font-mono`}
                  {...props}
                >
                  {children}
                </code>
              )
            },
            // Pre blocks (for code)
            pre: ({ children }) => (
              <pre className="bg-black/15 dark:bg-white/15 rounded-lg p-3 my-3 overflow-x-auto border border-black/10 dark:border-white/10">
                {children}
              </pre>
            ),
            // Headings
            h1: ({ children }) => (
              <h1 className="text-lg font-bold mt-4 mb-2 first:mt-0">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-base font-bold mt-3 mb-2 first:mt-0">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-sm font-semibold mt-3 mb-1 first:mt-0">
                {children}
              </h3>
            ),
            // Lists
            ul: ({ children }) => (
              <ul className="list-disc list-inside my-2 space-y-1">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal list-inside my-2 space-y-1">
                {children}
              </ol>
            ),
            li: ({ children }) => <li className="ml-2">{children}</li>,
            // Paragraphs
            p: ({ children }) => (
              <p className="my-2 first:mt-0 last:mb-0">{children}</p>
            ),
            // Links
            a: ({ href, children }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={`
                  ${isUser ? 'text-blue-200 hover:text-blue-100' : 'text-blue-600 hover:text-blue-700'}
                  underline underline-offset-2
                `}
              >
                {children}
              </a>
            ),
            // Blockquotes
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-current/30 pl-3 my-2 italic">
                {children}
              </blockquote>
            ),
            // Tables
            table: ({ children }) => (
              <div className="my-2 overflow-x-auto">
                <table className="min-w-full border-collapse">{children}</table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border border-current/20 px-2 py-1 text-left font-semibold bg-current/5">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-current/20 px-2 py-1">{children}</td>
            ),
            // Strong/Bold
            strong: ({ children }) => (
              <strong className="font-semibold">{children}</strong>
            ),
            // Emphasis/Italic
            em: ({ children }) => <em className="italic">{children}</em>,
          }}
        >
          {block.content}
        </ReactMarkdown>
      </div>
    )
  }

  // Render tool use blocks
  if (block.type === 'tool_use' || block.type === 'tool_result') {
    // Convert block to tool call format for ToolCallDisplay
    const toolCall = {
      id: block.id,
      name: block.metadata?.toolName || 'unknown',
      parameters: block.metadata?.input || {},
      result: block.metadata?.output,
      status:
        block.type === 'tool_result'
          ? ('completed' as const)
          : ('pending' as const),
      startTime: new Date().toISOString(), // Not ideal but we don't have this
      endTime:
        block.type === 'tool_result' ? new Date().toISOString() : undefined,
      error: block.metadata?.error,
    }

    return (
      <div className="block-tool my-2">
        <ToolCallDisplay toolCall={toolCall} />
      </div>
    )
  }

  // Render thinking blocks (usually hidden or styled differently)
  if (block.type === 'thinking') {
    if (process.env.NODE_ENV === 'development') {
      return (
        <div className="block-thinking opacity-50 italic text-sm my-1">
          <span className="text-xs text-muted-foreground">[thinking]</span>{' '}
          {block.content}
        </div>
      )
    }
    return null // Hide thinking blocks in production
  }

  // Unknown block type
  return (
    <div className="block-unknown text-muted-foreground text-sm my-1">
      [Unknown block type: {block.type}]
    </div>
  )
}
