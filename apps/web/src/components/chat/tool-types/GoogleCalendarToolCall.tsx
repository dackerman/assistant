import { Calendar, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { ToolCall } from '@/types/conversation'
import { formatInlineValue, formatMultilineValue } from './utils'

interface GoogleCalendarToolCallProps {
  toolCall: ToolCall
  isExpanded: boolean
  onToggle: () => void
  statusIcon: React.ReactNode
}

export function GoogleCalendarToolCall({
  toolCall,
  isExpanded,
  onToggle,
  statusIcon,
}: GoogleCalendarToolCallProps) {
  const params = toolCall.parameters
  const action = typeof params.action === 'string' ? params.action : ''

  const getActionDescription = () => {
    if (action === 'create_event') {
      return `Creating event: "${formatInlineValue(params.title)}"`
    }
    if (action === 'get_events') {
      const targetDate =
        params.date !== undefined && params.date !== null
          ? formatInlineValue(params.date)
          : 'today'
      return `Fetching events for ${targetDate}`
    }
    if (action === 'update_event') {
      return `Updating event: "${formatInlineValue(params.title)}"`
    }
    return 'Calendar operation'
  }

  return (
    <Card className="border-l-4 border-l-blue-400">
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
            <Calendar className="w-3 h-3 text-blue-500" />
            <span className="text-xs font-medium">Google Calendar</span>
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
              <div className="bg-blue-50 border border-blue-200 p-3 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-medium text-blue-700">
                    Event Details
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  {params.title !== undefined && params.title !== null && (
                    <div>
                      <span className="font-medium">Title:</span>{' '}
                      {formatInlineValue(params.title)}
                    </div>
                  )}
                  {params.start_time !== undefined &&
                    params.start_time !== null && (
                      <div>
                        <span className="font-medium">Start:</span>{' '}
                        {formatInlineValue(params.start_time)}
                      </div>
                    )}
                  {params.end_time !== undefined &&
                    params.end_time !== null && (
                      <div>
                        <span className="font-medium">End:</span>{' '}
                        {formatInlineValue(params.end_time)}
                      </div>
                    )}
                  {params.location !== undefined &&
                    params.location !== null && (
                      <div>
                        <span className="font-medium">Location:</span>{' '}
                        {formatInlineValue(params.location)}
                      </div>
                    )}
                  {params.attendees !== undefined &&
                    params.attendees !== null && (
                      <div>
                        <span className="font-medium">Attendees:</span>{' '}
                        {Array.isArray(params.attendees)
                          ? params.attendees
                              .map(attendee => formatInlineValue(attendee))
                              .join(', ')
                          : formatInlineValue(params.attendees)}
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
