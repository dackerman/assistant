export const CONVERSATION_STREAM_EVENT_TYPES = [
  'message-created',
  'message-updated',
  'prompt-started',
  'prompt-completed',
  'prompt-failed',
  'block-start',
  'block-delta',
  'block-end',
  'tool-call-started',
  'tool-call-progress',
  'tool-call-completed',
  'tool-call-failed',
  'conversation-updated',
] as const

export type ConversationStreamEventType =
  (typeof CONVERSATION_STREAM_EVENT_TYPES)[number]

export function isConversationStreamEventType(
  value: unknown
): value is ConversationStreamEventType {
  return (CONVERSATION_STREAM_EVENT_TYPES as readonly string[]).includes(
    value as ConversationStreamEventType
  )
}

export const CONVERSATION_STREAM_NOTIFICATION_TYPES = {
  message_created: 'message-created',
  message_updated: 'message-updated',
  prompt_started: 'prompt-started',
  prompt_completed: 'prompt-completed',
  prompt_failed: 'prompt-failed',
  block_start: 'block-start',
  block_delta: 'block-delta',
  block_end: 'block-end',
  tool_call_started: 'tool-call-started',
  tool_call_progress: 'tool-call-progress',
  tool_call_completed: 'tool-call-completed',
  tool_call_failed: 'tool-call-failed',
  conversation_updated: 'conversation-updated',
} as const satisfies Record<string, ConversationStreamEventType>

export type ConversationStreamNotificationType =
  keyof typeof CONVERSATION_STREAM_NOTIFICATION_TYPES

export function toConversationStreamEventType(
  notificationType: ConversationStreamNotificationType
): ConversationStreamEventType {
  return CONVERSATION_STREAM_NOTIFICATION_TYPES[notificationType]
}
