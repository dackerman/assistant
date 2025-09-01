import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ToolCall } from '@/types/conversation'

interface ToolCallDisplayProps {
  toolCall: ToolCall
}

export function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
  const getStatusColor = (status: ToolCall['status']) => {
    switch (status) {
      case 'pending': return 'bg-gray-500'
      case 'running': return 'bg-blue-500 animate-pulse'
      case 'completed': return 'bg-green-500'
      case 'error': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  return (
    <Card className="mt-2 border-l-4 border-l-blue-400">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono">{toolCall.name}</CardTitle>
          <Badge className={getStatusColor(toolCall.status)}>
            {toolCall.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Parameters:</p>
            <pre className="text-xs bg-muted p-2 rounded font-mono overflow-x-auto">
              {JSON.stringify(toolCall.parameters, null, 2)}
            </pre>
          </div>
          
          {toolCall.result && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Result:</p>
              <pre className="text-xs bg-green-50 p-2 rounded font-mono overflow-x-auto">
                {typeof toolCall.result === 'string' 
                  ? toolCall.result 
                  : JSON.stringify(toolCall.result, null, 2)
                }
              </pre>
            </div>
          )}
          
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Started: {new Date(toolCall.startTime).toLocaleTimeString()}</span>
            {toolCall.endTime && (
              <span>Ended: {new Date(toolCall.endTime).toLocaleTimeString()}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}