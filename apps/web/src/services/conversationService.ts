const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4001/api'

// Types for active stream response
interface Prompt {
  id: number
  conversationId: number
  messageId: number
  model: string
  status: 'queued' | 'streaming' | 'completed' | 'failed'
  createdAt: string
  updatedAt: string
  systemMessage?: string | null
  state?:
    | 'IN_PROGRESS'
    | 'WAITING_FOR_TOOLS'
    | 'WAITING_FOR_RESPONSE'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELED'
    | string
}

interface Block {
  id: number
  messageId: number
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking'
  content: string
  order: number
  metadata?: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface ActiveStream {
  prompt: Prompt
  blocks: Block[]
}

export interface IConversationService {
  createConversation(title?: string): Promise<{ id: number }>
  getConversation(conversationId: number): Promise<{
    conversation: ApiConversation
    messages: ApiMessage[]
  }>
  getActiveStream(conversationId: number): Promise<{
    activeStream: ActiveStream | null
  }>
  sendMessage(
    conversationId: number,
    content: string,
    model?: string
  ): Promise<{ userMessageId: number; promptId: number }>
  listConversations(): Promise<{ conversations: ApiConversation[] }>
  updateTitle(conversationId: number, title: string): Promise<void>
  deleteConversation(conversationId: number): Promise<void>
}

export interface ApiToolCall {
  id: number
  apiToolCallId?: string
  toolName: string
  request: Record<string, unknown>
  response?: unknown
  state: string
  completedAt?: string
  providerExecuted?: boolean
  dynamic?: boolean
}

export interface ApiBlock {
  id: number
  type: 'text' | 'tool_call' | 'tool_result' | 'thinking'
  content: string
  createdAt: string
  toolCall?: ApiToolCall
}

export interface ApiMessage {
  id: number
  role: 'user' | 'assistant' | 'system'
  createdAt: string
  promptId?: number
  model?: string
  blocks?: ApiBlock[]
}

export interface ApiConversation {
  id: number
  title: string | null
  createdAt: string
  updatedAt: string
}

export class ConversationService implements IConversationService {
  /**
   * Create a new conversation
   */
  async createConversation(title?: string): Promise<{ id: number }> {
    const response = await fetch(`${API_BASE}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })

    if (!response.ok) {
      throw new Error('Failed to create conversation')
    }

    return response.json()
  }

  /**
   * Get conversation with all messages and blocks
   */
  async getConversation(conversationId: number): Promise<{
    conversation: ApiConversation
    messages: ApiMessage[]
  }> {
    const response = await fetch(`${API_BASE}/conversations/${conversationId}`)

    if (!response.ok) {
      throw new Error('Failed to get conversation')
    }

    return response.json()
  }

  /**
   * Get active streaming state
   */
  async getActiveStream(conversationId: number): Promise<{
    activeStream: ActiveStream | null
  }> {
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/stream`
    )

    if (!response.ok) {
      throw new Error('Failed to get active stream')
    }

    return response.json()
  }

  /**
   * Send a message to a conversation
   */
  async sendMessage(
    conversationId: number,
    content: string,
    model?: string
  ): Promise<{ userMessageId: number; promptId: number }> {
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, model }),
      }
    )

    if (!response.ok) {
      throw new Error('Failed to send message')
    }

    return response.json()
  }

  /**
   * List all conversations
   */
  async listConversations(): Promise<{ conversations: ApiConversation[] }> {
    const response = await fetch(`${API_BASE}/conversations`)

    if (!response.ok) {
      throw new Error('Failed to list conversations')
    }

    return response.json()
  }

  /**
   * Update conversation title
   */
  async updateTitle(conversationId: number, title: string): Promise<void> {
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }
    )

    if (!response.ok) {
      throw new Error('Failed to update conversation title')
    }
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(conversationId: number): Promise<void> {
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}`,
      {
        method: 'DELETE',
      }
    )

    if (!response.ok) {
      throw new Error('Failed to delete conversation')
    }
  }
}

export const conversationService = new ConversationService()
