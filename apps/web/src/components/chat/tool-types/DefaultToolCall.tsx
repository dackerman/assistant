import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { ToolCall } from '@/types/conversation'

interface DefaultToolCallProps {
  toolCall: ToolCall
  isExpanded: boolean
  onToggle: () => void
  statusIcon: React.ReactNode
}

export function DefaultToolCall({ toolCall, isExpanded, onToggle, statusIcon }: DefaultToolCallProps) {
  const getSimpleDescription = () => {
    // For write commands, show the file path
    if (toolCall.name === 'write' && toolCall.parameters.filePath) {
      return `Write to ${toolCall.parameters.filePath}`
    }
    
    // For other tools, show description if available, otherwise parameters
    if (toolCall.parameters.description) {
      return toolCall.parameters.description
    }
    
    // Fallback to showing the tool name with first parameter
    const firstParam = Object.entries(toolCall.parameters)[0]
    return firstParam ? `${firstParam[0]}: ${String(firstParam[1]).slice(0, 50)}...` : 'No parameters'
  }

  return (
    <Card className="border-l-4 border-l-purple-400">
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
            <CardTitle className="text-xs font-mono">{toolCall.name}</CardTitle>
          </div>
          {statusIcon}
        </div>
        <div className="text-xs text-muted-foreground font-mono mt-1 leading-tight">
          {getSimpleDescription()}
        </div>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="pt-0">
          <div className="space-y-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1 font-medium">Parameters:</p>
              <pre className="text-xs bg-muted p-2 rounded font-mono overflow-x-auto leading-tight">
                {JSON.stringify(toolCall.parameters, null, 2)}
              </pre>
            </div>
            
            {toolCall.result && (
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium">Result:</p>
                <pre className="text-xs bg-green-50 p-2 rounded font-mono overflow-x-auto border border-green-200 leading-tight">
                  {typeof toolCall.result === 'string' 
                    ? toolCall.result 
                    : JSON.stringify(toolCall.result, null, 2)
                  }
                </pre>
              </div>
            )}
            
            <div className="flex flex-col sm:flex-row sm:justify-between text-xs text-muted-foreground pt-1 border-t gap-1">
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
