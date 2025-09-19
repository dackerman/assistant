import type { ConversationStreamEventType } from '@core/types/conversationStream'

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
  | {
      type: Extract<ConversationStreamEventType, 'message-created'>
      message: SnapshotMessage
    }
  | {
      type: Extract<ConversationStreamEventType, 'message-updated'>
      message: SnapshotMessage
    }
  | {
      type: Extract<ConversationStreamEventType, 'prompt-started'>
      prompt: SnapshotPrompt
    }
  | {
      type: Extract<ConversationStreamEventType, 'prompt-completed'>
      prompt: SnapshotPrompt
    }
  | {
      type: Extract<ConversationStreamEventType, 'prompt-failed'>
      prompt: SnapshotPrompt
      error?: string | null
    }
  | {
      type: Extract<ConversationStreamEventType, 'block-start'>
      promptId: number
      messageId: number
      blockId: number
      blockType?: SnapshotBlock['type']
    }
  | {
      type: Extract<ConversationStreamEventType, 'block-delta'>
      promptId: number
      messageId: number
      blockId: number
      content: string
    }
  | {
      type: Extract<ConversationStreamEventType, 'block-end'>
      promptId: number
      messageId: number
      blockId: number
    }
  | {
      type: Extract<ConversationStreamEventType, 'tool-call-started'>
      toolCall: SnapshotToolCall
      input: Record<string, unknown>
    }
  | {
      type: Extract<ConversationStreamEventType, 'tool-call-progress'>
      toolCallId: number
      blockId: number | null
      output: string
    }
  | {
      type: Extract<ConversationStreamEventType, 'tool-call-completed'>
      toolCall: SnapshotToolCall
    }
  | {
      type: Extract<ConversationStreamEventType, 'tool-call-failed'>
      toolCall: SnapshotToolCall
      error: string | null
    }

export interface ConversationStreamPayload {
  snapshot: ConversationSnapshot
  events: AsyncGenerator<ConversationStreamEvent>
}

export type { ConversationStreamEventType } from '@core/types/conversationStream'
