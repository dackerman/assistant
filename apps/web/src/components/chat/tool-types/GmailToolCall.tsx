import { ChevronDown, ChevronRight, Mail } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { ToolCall } from '@/types/conversation'
import { formatInlineValue, formatMultilineValue } from './utils'

interface GmailToolCallProps {
  toolCall: ToolCall
  isExpanded: boolean
  onToggle: () => void
  statusIcon: React.ReactNode
}

export function GmailToolCall({
  toolCall,
  isExpanded,
  onToggle,
  statusIcon,
}: GmailToolCallProps) {
  const params = toolCall.parameters
  const action = typeof params.action === 'string' ? params.action : ''

  const getActionDescription = () => {
    if (action === 'send_email') {
      return `Sending email to: ${formatInlineValue(params.to)}`
    }
    if (action === 'get_emails') {
      return `Fetching emails from inbox`
    }
    if (action === 'reply_to_email') {
      return `Replying to email: "${formatInlineValue(params.subject)}"`
    }
    return 'Gmail operation'
  }

  return (
    <Card className="border-l-4 border-l-red-400">
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
            <Mail className="w-3 h-3 text-red-500" />
            <span className="text-xs font-medium">Gmail</span>
          </div>
          {statusIcon}
        </div>
        <div className="text-xs text-muted-foreground mt-1 leading-tight">
          {getActionDescription()}
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          <div className="space-y-3">
            <div>
              <div className="bg-red-50 border border-red-200 p-3 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <Mail className="w-4 h-4 text-red-500" />
                  <span className="text-xs font-medium text-red-700">
                    Email Details
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  {params.to !== undefined && params.to !== null && (
                    <div>
                      <span className="font-medium">To:</span>{' '}
                      {formatInlineValue(params.to)}
                    </div>
                  )}
                  {params.subject !== undefined && params.subject !== null && (
                    <div>
                      <span className="font-medium">Subject:</span>{' '}
                      {formatInlineValue(params.subject)}
                    </div>
                  )}
                  {params.body !== undefined && params.body !== null && (
                    <div>
                      <span className="font-medium">Body:</span>
                      <div className="mt-1 p-2 bg-white border rounded text-xs max-h-20 overflow-y-auto">
                        {formatMultilineValue(params.body)}
                      </div>
                    </div>
                  )}
                  {params.cc !== undefined && params.cc !== null && (
                    <div>
                      <span className="font-medium">CC:</span>{' '}
                      {formatInlineValue(params.cc)}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {toolCall.result !== undefined && toolCall.result !== null && (
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium">
                  Result:
                </p>
                <div className="bg-green-50 border border-green-200 p-3 rounded text-xs">
                  {formatMultilineValue(toolCall.result)}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:justify-between text-xs text-muted-foreground pt-2 border-t gap-1">
              <span>
                Started: {new Date(toolCall.startTime).toLocaleTimeString()}
              </span>
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
  )
}
