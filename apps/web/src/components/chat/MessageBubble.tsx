import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import type { Message } from '@/types/conversation'
import { ToolCallDisplay } from './ToolCallDisplay'
import { User, Bot, Settings } from 'lucide-react'

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.type === 'user'
  const isSystem = message.type === 'system'
  
  const getAvatar = () => {
    if (isUser) return <User className="w-4 h-4" />
    if (isSystem) return <Settings className="w-4 h-4" />
    return <Bot className="w-4 h-4" />
  }
  


  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} mb-6`}>
      <Avatar className="w-8 h-8">
        <AvatarFallback className={`
          ${isUser ? 'bg-blue-500 text-white' : ''}
          ${isSystem ? 'bg-gray-500 text-white' : ''}
          ${!isUser && !isSystem ? 'bg-green-500 text-white' : ''}
        `}>
          {getAvatar()}
        </AvatarFallback>
      </Avatar>
      
      <div className={`flex-1 max-w-[80%] ${isUser ? 'text-right' : 'text-left'}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">
            {isUser ? 'You' : isSystem ? 'System' : 'Assistant'}
          </span>
          <span className="text-xs text-muted-foreground">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
          {message.metadata?.model && (
            <Badge variant="outline" className="text-xs">
              {message.metadata.model}
            </Badge>
          )}
        </div>
        
        <div className={`
          rounded-lg p-3 whitespace-pre-wrap
          ${isUser 
            ? 'bg-blue-500 text-white ml-auto' 
            : isSystem 
            ? 'bg-gray-100 text-gray-900'
            : 'bg-muted'
          }
        `}>
          {message.content}
        </div>
        
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.toolCalls.map((toolCall) => (
              <ToolCallDisplay key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        )}
        
        {message.metadata && (message.metadata.tokens || message.metadata.cost) && (
          <div className="flex gap-2 mt-2 text-xs text-muted-foreground">
            {message.metadata.tokens && (
              <span>{message.metadata.tokens} tokens</span>
            )}
            {message.metadata.cost && (
              <span>${message.metadata.cost.toFixed(4)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}