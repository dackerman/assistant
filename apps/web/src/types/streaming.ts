export interface SnapshotConversation {
  id: number
  title: string | null
  createdAt: string
  updatedAt: string
}

export interface SnapshotBlock {
  id: number
  messageId: number
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking'
  content: string | null
  order?: number | null
  metadata?: Record<string, unknown> | null
  toolCall?: SnapshotToolCall | null
}

export interface SnapshotMessage {
  id: number
  conversationId: number
  role: 'user' | 'assistant' | 'system'
  content: string | null
  createdAt: string
  updatedAt: string
  status?: 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | null
  promptId?: number | null
  model?: string | null
  blocks?: SnapshotBlock[]
}

export interface SnapshotPrompt {
  id: number
  conversationId: number
  messageId: number
  status: 'queued' | 'streaming' | 'completed' | 'failed'
  model: string
  createdAt: string
  completedAt: string | null
  systemMessage?: string | null
  error?: string | null
}

export interface SnapshotToolCall {
  id: number
  apiToolCallId?: string | null
  blockId: number | null
  promptId: number
  name: string
  state: string
  output: string | null
  input?: Record<string, unknown> | null
  error?: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  providerExecuted?: boolean
  dynamic?: boolean
  startedAt?: string | null
  timeoutAt?: string | null
}

export interface ConversationSnapshot {
  conversation: SnapshotConversation
  messages: SnapshotMessage[]
}

export type ConversationStreamEvent =
  | { type: 'message-created'; message: SnapshotMessage }
  | { type: 'message-updated'; message: SnapshotMessage }
  | { type: 'prompt-started'; prompt: SnapshotPrompt }
  | { type: 'prompt-completed'; prompt: SnapshotPrompt }
  | { type: 'prompt-failed'; prompt: SnapshotPrompt; error?: string | null }
  | {
      type: 'block-start'
      promptId: number
      messageId: number
      blockId: number
      blockType?: SnapshotBlock['type']
    }
  | {
      type: 'block-delta'
      promptId: number
      messageId: number
      blockId: number
      content: string
    }
  | {
      type: 'block-end'
      promptId: number
      messageId: number
      blockId: number
    }
  | {
      type: 'tool-call-started'
      toolCall: SnapshotToolCall
      input: Record<string, unknown>
    }
  | {
      type: 'tool-call-progress'
      toolCallId: number
      blockId: number | null
      output: string
    }
  | {
      type: 'tool-call-completed'
      toolCall: SnapshotToolCall
    }
  | {
      type: 'tool-call-failed'
      toolCall: SnapshotToolCall
      error: string | null
    }

export interface ConversationStreamPayload {
  snapshot: ConversationSnapshot
  events: AsyncGenerator<ConversationStreamEvent>
}
