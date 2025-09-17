import { ChevronDown, ChevronRight, Loader2, Terminal } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { ToolCall } from '@/types/conversation'
import { formatInlineValue, formatMultilineValue } from './utils'

interface BashToolCallProps {
  toolCall: ToolCall
  isExpanded: boolean
  onToggle: () => void
  statusIcon: React.ReactNode
}

export function BashToolCall({
  toolCall,
  isExpanded,
  onToggle,
  statusIcon,
}: BashToolCallProps) {
  const params = toolCall.parameters
  const command = formatInlineValue(params.command)
  const hasResult = toolCall.result !== undefined && toolCall.result !== null

  return (
    <>
      <style>
        {`
          @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
          }
        `}
      </style>
      <Card className="border-l-4 border-l-green-400">
        <CardHeader
          className="pb-1 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={onToggle}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
              )}
              <Terminal className="w-3 h-3 text-green-500" />
              <span className="text-xs font-mono font-medium">bash</span>
            </div>
            {statusIcon}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-1 leading-tight">
            $ {command || 'No command'}
          </div>
        </CardHeader>

        {isExpanded && (
          <CardContent className="pt-0">
            <div className="space-y-3">
              <div>
                <div className="bg-gray-900 text-green-400 p-3 rounded font-mono text-xs">
                  <div className="flex items-center gap-2 mb-2 text-gray-400">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                      <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    </div>
                    <span>bash</span>
                  </div>
                  <div className="text-green-400">
                    <span className="text-blue-400">$</span> {command}
                  </div>
                </div>
              </div>

              {(hasResult || toolCall.status === 'running') && (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-xs text-muted-foreground font-medium">
                      Output:
                    </p>
                    {toolCall.status === 'running' && (
                      <div className="flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                        <span className="text-xs text-blue-500 font-medium">
                          Running...
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="bg-gray-900 text-gray-100 p-3 rounded font-mono text-xs overflow-x-auto leading-relaxed whitespace-pre relative">
                    {hasResult ? formatMultilineValue(toolCall.result) : ''}
                    {toolCall.status === 'running' && (
                      <span
                        className="inline-block w-2 h-4 bg-green-400 ml-1 animate-pulse"
                        style={{ animation: 'blink 1s infinite' }}
                      />
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:justify-between text-xs text-muted-foreground pt-2 border-t gap-1">
                <div className="flex items-center gap-3">
                  <span>
                    Started: {new Date(toolCall.startTime).toLocaleTimeString()}
                  </span>
                  {toolCall.status && (
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        toolCall.status === 'completed'
                          ? 'bg-green-100 text-green-800'
                          : toolCall.status === 'running'
                            ? 'bg-blue-100 text-blue-800'
                            : toolCall.status === 'error'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {toolCall.status}
                    </span>
                  )}
                </div>
                {toolCall.endTime && (
                  <span>
                    Ended: {new Date(toolCall.endTime).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </>
  )
}
