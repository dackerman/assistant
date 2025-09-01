export interface ToolCall {
  id: string
  name: string
  parameters: Record<string, any>
  result?: any
  status: 'pending' | 'running' | 'completed' | 'error'
  startTime: string
  endTime?: string
}

export interface Message {
  id: string
  type: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  toolCalls?: ToolCall[]
  metadata?: {
    model?: string
    tokens?: number
    cost?: number
  }
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: string
  updatedAt: string
}