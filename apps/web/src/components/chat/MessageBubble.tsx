import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { Message } from "@/types/conversation";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { User, Bot, Settings } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.type === "user";
  const isSystem = message.type === "system";

  const getAvatar = () => {
    if (isUser) return <User className="w-3 h-3 sm:w-4 sm:h-4" />;
    if (isSystem) return <Settings className="w-3 h-3 sm:w-4 sm:h-4" />;
    return <Bot className="w-3 h-3 sm:w-4 sm:h-4" />;
  };

  return (
    <div
      className={`flex gap-2 sm:gap-3 ${isUser ? "flex-row-reverse" : "flex-row"} mb-4 sm:mb-6`}
    >
      <Avatar className="w-6 h-6 sm:w-8 sm:h-8 mt-1">
        <AvatarFallback
          className={`
          ${isUser ? "bg-blue-500 text-white" : ""}
          ${isSystem ? "bg-gray-500 text-white" : ""}
          ${!isUser && !isSystem ? "bg-green-500 text-white" : ""}
        `}
        >
          {getAvatar()}
        </AvatarFallback>
      </Avatar>

      <div
        className={`flex-1 max-w-[85%] sm:max-w-[80%] ${isUser ? "text-right" : "text-left"}`}
      >
        <div className="flex items-center gap-1.5 sm:gap-2 mb-1 flex-wrap">
          <span className="text-xs sm:text-sm font-medium">
            {isUser ? "You" : isSystem ? "System" : "Assistant"}
          </span>
          <span className="text-xs text-muted-foreground">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
          {message.metadata?.model && (
            <Badge variant="outline" className="text-xs px-1.5 py-0.5">
              {message.metadata.model}
            </Badge>
          )}
        </div>

        <div
          className={`
          message-content rounded-lg p-2 sm:p-3 text-sm leading-relaxed
          ${
            isUser
              ? "bg-blue-500 text-white ml-auto"
              : isSystem
                ? "bg-gray-100 text-gray-900"
                : "bg-muted"
          }
        `}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight, rehypeRaw]}
            components={{
              // Code blocks
              code: ({ className, children, ...props }) => {
                const match = /language-(\w+)/.exec(className || "");
                const isInline = !match;

                if (isInline) {
                  return (
                    <code
                      className="bg-black/15 dark:bg-white/15 rounded px-1.5 py-0.5 text-xs font-mono"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }

                return (
                  <code
                    className={`${className || ""} block overflow-x-auto text-xs font-mono`}
                    {...props}
                  >
                    {children}
                  </code>
                );
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
                  className="underline hover:no-underline opacity-90 hover:opacity-100"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
              // Blockquotes
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-current/30 pl-3 my-2 italic opacity-90">
                  {children}
                </blockquote>
              ),
              // Tables
              table: ({ children }) => (
                <div className="my-2 overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-current/20 px-2 py-1 text-left font-semibold bg-current/5">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-current/20 px-2 py-1">
                  {children}
                </td>
              ),
              // Strong/Bold
              strong: ({ children }) => (
                <strong className="font-semibold">{children}</strong>
              ),
              // Emphasis/Italic
              em: ({ children }) => <em className="italic">{children}</em>,
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Reasoning Display */}
        {message.reasoning && (
          <div className="mt-2 p-2 rounded border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20">
            <div className="text-xs font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
              AI Reasoning
            </div>
            <div className="text-xs text-yellow-700 dark:text-yellow-300 whitespace-pre-wrap">
              {message.reasoning}
            </div>
          </div>
        )}

        {/* Tool Calls Display */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-1 sm:mt-1.5 space-y-1 sm:space-y-1">
            {message.toolCalls.map((toolCall) => (
              <ToolCallDisplay key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        )}

        {/* Tool Results Display */}
        {message.toolResults && message.toolResults.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.toolResults.map((result) => (
              <div
                key={result.id}
                className="p-2 rounded border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
              >
                <div className="text-xs font-semibold text-green-800 dark:text-green-200 mb-1">
                  Tool Result: {result.name}
                </div>
                <div className="text-xs text-green-700 dark:text-green-300 whitespace-pre-wrap">
                  {result.result}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tool Errors Display */}
        {message.toolErrors && message.toolErrors.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.toolErrors.map((error) => (
              <div
                key={error.id}
                className="p-2 rounded border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
              >
                <div className="text-xs font-semibold text-red-800 dark:text-red-200 mb-1">
                  Tool Error: {error.name}
                </div>
                <div className="text-xs text-red-700 dark:text-red-300 whitespace-pre-wrap">
                  {typeof error.error === "string"
                    ? error.error
                    : JSON.stringify(error.error)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sources Display */}
        {message.sources && message.sources.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.sources.map((source, index) => (
              <div
                key={index}
                className="p-2 rounded border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20"
              >
                <div className="text-xs font-semibold text-blue-800 dark:text-blue-200 mb-1">
                  Source: {source.sourceType || "Unknown"}
                </div>
                {source.url && (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 dark:text-blue-400 underline hover:no-underline"
                  >
                    {source.title || source.url}
                  </a>
                )}
                {source.filename && (
                  <div className="text-xs text-blue-700 dark:text-blue-300">
                    File: {source.filename}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Files Display */}
        {message.files && message.files.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.files.map((file, index) => (
              <div
                key={index}
                className="p-2 rounded border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/20"
              >
                <div className="text-xs font-semibold text-purple-800 dark:text-purple-200 mb-1">
                  Generated File
                </div>
                <div className="text-xs text-purple-700 dark:text-purple-300 mb-2">
                  Type: {file.mediaType}
                </div>
                {file.mediaType.startsWith("image/") ? (
                  <img
                    src={`data:${file.mediaType};base64,${file.base64}`}
                    alt="Generated image"
                    className="max-w-full h-auto rounded"
                  />
                ) : (
                  <a
                    href={`data:${file.mediaType};base64,${file.base64}`}
                    download={`generated-file.${file.mediaType.split("/")[1] || "bin"}`}
                    className="text-xs text-purple-600 dark:text-purple-400 underline hover:no-underline"
                  >
                    Download File
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {message.metadata &&
          (message.metadata.tokens ||
            message.metadata.cost ||
            message.metadata.finishReason) && (
            <div className="flex gap-2 mt-1.5 sm:mt-2 text-xs text-muted-foreground flex-wrap">
              {message.metadata.tokens && (
                <span>{message.metadata.tokens} tokens</span>
              )}
              {message.metadata.cost && (
                <span>${message.metadata.cost.toFixed(4)}</span>
              )}
              {message.metadata.finishReason && (
                <Badge variant="outline" className="text-xs px-1.5 py-0.5">
                  {message.metadata.finishReason}
                </Badge>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
