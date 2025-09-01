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
    if (isUser) return <User className="w-3 h-3 sm:w-4 sm:h-4" />
    if (isSystem) return <Settings className="w-3 h-3 sm:w-4 sm:h-4" />
    return <Bot className="w-3 h-3 sm:w-4 sm:h-4" />
  }
  


  return (
    <div className={`flex gap-2 sm:gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} mb-4 sm:mb-6`}>
      <Avatar className="w-6 h-6 sm:w-8 sm:h-8 mt-1">
        <AvatarFallback className={`
          ${isUser ? 'bg-blue-500 text-white' : ''}
          ${isSystem ? 'bg-gray-500 text-white' : ''}
          ${!isUser && !isSystem ? 'bg-green-500 text-white' : ''}
        `}>
          {getAvatar()}
        </AvatarFallback>
      </Avatar>
      
      <div className={`flex-1 max-w-[85%] sm:max-w-[80%] ${isUser ? 'text-right' : 'text-left'}`}>
        <div className="flex items-center gap-1.5 sm:gap-2 mb-1 flex-wrap">
          <span className="text-xs sm:text-sm font-medium">
            {isUser ? 'You' : isSystem ? 'System' : 'Assistant'}
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
        
        <div className={`
          rounded-lg p-2 sm:p-3 whitespace-pre-wrap text-sm leading-relaxed
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
          <div className="mt-1 sm:mt-1.5 space-y-1 sm:space-y-1">
            {message.toolCalls.map((toolCall) => (
              <ToolCallDisplay key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        )}
        
        {message.metadata && (message.metadata.tokens || message.metadata.cost) && (
          <div className="flex gap-2 mt-1.5 sm:mt-2 text-xs text-muted-foreground">
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