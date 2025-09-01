import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { ChevronRight, ChevronDown, Calendar } from 'lucide-react'
import type { ToolCall } from '@/types/conversation'

interface GoogleCalendarToolCallProps {
  toolCall: ToolCall
  isExpanded: boolean
  onToggle: () => void
  statusIcon: React.ReactNode
}

export function GoogleCalendarToolCall({ toolCall, isExpanded, onToggle, statusIcon }: GoogleCalendarToolCallProps) {
  const getActionDescription = () => {
    if (toolCall.parameters.action === 'create_event') {
      return `Creating event: "${toolCall.parameters.title}"`
    }
    if (toolCall.parameters.action === 'get_events') {
      return `Fetching events for ${toolCall.parameters.date || 'today'}`
    }
    if (toolCall.parameters.action === 'update_event') {
      return `Updating event: "${toolCall.parameters.title}"`
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
                  <span className="text-xs font-medium text-blue-700">Event Details</span>
                </div>
                <div className="space-y-2 text-xs">
                  {toolCall.parameters.title && (
                    <div><span className="font-medium">Title:</span> {toolCall.parameters.title}</div>
                  )}
                  {toolCall.parameters.start_time && (
                    <div><span className="font-medium">Start:</span> {toolCall.parameters.start_time}</div>
                  )}
                  {toolCall.parameters.end_time && (
                    <div><span className="font-medium">End:</span> {toolCall.parameters.end_time}</div>
                  )}
                  {toolCall.parameters.location && (
                    <div><span className="font-medium">Location:</span> {toolCall.parameters.location}</div>
                  )}
                  {toolCall.parameters.attendees && (
                    <div><span className="font-medium">Attendees:</span> {Array.isArray(toolCall.parameters.attendees) ? toolCall.parameters.attendees.join(', ') : toolCall.parameters.attendees}</div>
                  )}
                </div>
              </div>
            </div>
            
            {toolCall.result && (
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium">Result:</p>
                <div className="bg-green-50 border border-green-200 p-3 rounded text-xs">
                  {typeof toolCall.result === 'string' 
                    ? toolCall.result 
                    : JSON.stringify(toolCall.result, null, 2)
                  }
                </div>
              </div>
            )}
            
            <div className="flex flex-col sm:flex-row sm:justify-between text-xs text-muted-foreground pt-2 border-t gap-1">
              <span>Started: {new Date(toolCall.startTime).toLocaleTimeString()}</span>
              {toolCall.endTime && (
                <span>Ended: {new Date(toolCall.endTime).toLocaleTimeString()}</span>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
