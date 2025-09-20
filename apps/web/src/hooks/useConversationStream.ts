import { useEffect, useMemo, useRef, useState } from 'react'
import type { Block, Message } from '@/types/conversation'
import type {
  ConversationSnapshot,
  ConversationStreamEvent,
  ConversationStreamPayload,
  SnapshotBlock,
  SnapshotConversation,
  SnapshotMessage,
} from '@/types/streaming'

interface ConversationStreamClient {
  streamConversation: (
    conversationId: number,
    userId: number
  ) => Promise<ConversationStreamPayload | null>
}
export type { ConversationStreamClient }

interface UseConversationStreamOptions {
  conversationId: number | null
  userId: number | null
  client: ConversationStreamClient
}

interface UseConversationStreamResult {
  status: 'idle' | 'loading' | 'ready' | 'error'
  conversation: SnapshotConversation | null
  messages: Message[]
  error: string | null
  isStreaming: boolean
}

interface InternalBlock {
  id: number
  type: SnapshotBlock['type']
  content: string
  metadata?: Record<string, unknown> | null
}

interface InternalMessage {
  id: number
  role: SnapshotMessage['role']
  createdAt: string
  updatedAt: string
  content: string
  promptId?: number
  model?: string | null
  status?: SnapshotMessage['status']
  blocks: InternalBlock[]
}

interface InternalConversationState {
  conversation: SnapshotConversation
  messages: InternalMessage[]
}

function createInternalMessage(message: SnapshotMessage): InternalMessage {
  let blocks = (message.blocks ?? [])
    .sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id))
    .map(block => ({
      id: block.id,
      type: block.type,
      content: block.content ?? '',
      metadata: block.metadata ?? null,
    }))

  // If no blocks but message has content, create a text block from the content
  if (blocks.length === 0 && message.content) {
    blocks = [{
      id: message.id, // Use message ID as block ID for fallback
      type: 'text' as const,
      content: message.content,
      metadata: null,
    }]
  }

  return {
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    content: message.content ?? '',
    promptId: message.promptId ?? undefined,
    model: message.model ?? null,
    status: message.status,
    blocks,
  }
}

function createInternalState(
  snapshot: ConversationSnapshot
): InternalConversationState {
  const messages = snapshot.messages
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map(createInternalMessage)

  return {
    conversation: snapshot.conversation,
    messages,
  }
}

function findMessage(state: InternalConversationState, messageId: number): InternalMessage | null {
  return state.messages.find(m => m.id === messageId) ?? null
}

function findBlock(message: InternalMessage, blockId: number): InternalBlock | null {
  return message.blocks.find(b => b.id === blockId) ?? null
}

function upsertMessage(
  state: InternalConversationState,
  incoming: SnapshotMessage
): InternalConversationState {
  const existingIndex = state.messages.findIndex(m => m.id === incoming.id)

  if (existingIndex === -1) {
    // New message - add it in chronological order
    const newMessage = createInternalMessage(incoming)
    const messages = [...state.messages, newMessage]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    return { ...state, messages }
  }

  // Update existing message
  const existingMessage = state.messages[existingIndex]
  const updatedMessage = {
    ...existingMessage,
    updatedAt: incoming.updatedAt,
    content: incoming.content ?? existingMessage.content,
    status: incoming.status ?? existingMessage.status,
    promptId: incoming.promptId ?? existingMessage.promptId,
    model: incoming.model ?? existingMessage.model,
    // Only replace blocks if existing message has no blocks (initial state)
    // Otherwise, preserve blocks built from streaming events
    blocks: existingMessage.blocks.length === 0 && incoming.blocks ?
      createInternalMessage(incoming).blocks :
      existingMessage.blocks,
  }

  const messages = [...state.messages]
  messages[existingIndex] = updatedMessage
  return { ...state, messages }
}

function updateMessage(
  state: InternalConversationState,
  messageId: number,
  updater: (message: InternalMessage) => InternalMessage
): InternalConversationState {
  const index = state.messages.findIndex(m => m.id === messageId)
  if (index === -1) return state

  const updated = updater(state.messages[index])
  const messages = [...state.messages]
  messages[index] = updated
  return { ...state, messages }
}

function ensureBlock(message: InternalMessage, blockId: number, blockType: SnapshotBlock['type']): InternalMessage {
  if (findBlock(message, blockId)) return message

  const newBlock: InternalBlock = {
    id: blockId,
    type: blockType,
    content: '',
    metadata: null,
  }

  return {
    ...message,
    blocks: [...message.blocks, newBlock],
  }
}

function updateBlock(
  message: InternalMessage,
  blockId: number,
  updater: (block: InternalBlock) => InternalBlock
): InternalMessage {
  const blockIndex = message.blocks.findIndex(b => b.id === blockId)
  if (blockIndex === -1) return message

  const updated = updater(message.blocks[blockIndex])
  const blocks = [...message.blocks]
  blocks[blockIndex] = updated
  return { ...message, blocks }
}

function appendToBlock(message: InternalMessage, blockId: number, delta: string): InternalMessage {
  return updateBlock(message, blockId, block => ({
    ...block,
    content: block.content + delta,
  }))
}

function applyEvent(
  state: InternalConversationState,
  event: ConversationStreamEvent
): InternalConversationState {
  switch (event.type) {
    case 'message-created':
    case 'message-updated': {
      return upsertMessage(state, event.message)
    }

    case 'block-start': {
      return updateMessage(state, event.messageId, message =>
        ensureBlock(message, event.blockId, event.blockType ?? 'text')
      )
    }

    case 'block-delta': {
      return updateMessage(state, event.messageId, message =>
        appendToBlock(message, event.blockId, event.content)
      )
    }

    case 'block-end':
      // Block is complete, no action needed since we don't expect out-of-order events
      return state

    case 'prompt-started': {
      return updateMessage(state, event.prompt.messageId, message => ({
        ...message,
        status: 'processing',
        promptId: event.prompt.id,
        model: event.prompt.model ?? message.model,
      }))
    }

    case 'prompt-completed': {
      return updateMessage(state, event.prompt.messageId, message => ({
        ...message,
        status: 'completed',
        promptId: event.prompt.id,
        model: event.prompt.model ?? message.model,
      }))
    }

    case 'prompt-failed': {
      return updateMessage(state, event.prompt.messageId, message => ({
        ...message,
        status: 'failed',
        promptId: event.prompt.id,
        model: event.prompt.model ?? message.model,
      }))
    }

    case 'tool-call-started': {
      // Find the message by promptId and update the corresponding tool block
      const messageIndex = state.messages.findIndex(m => m.promptId === event.toolCall.promptId)
      if (messageIndex === -1) return state

      const message = state.messages[messageIndex]
      const toolBlockId = event.toolCall.blockId

      if (!toolBlockId) return state

      return updateMessage(state, message.id, msg =>
        updateBlock(msg, toolBlockId, block => ({
          ...block,
          type: 'tool_use',
          metadata: {
            ...block.metadata,
            toolName: event.toolCall.name,
            toolUseId: event.toolCall.apiToolCallId || `${event.toolCall.id}`,
            toolCallId: `${event.toolCall.id}`,
            input: event.toolCall.input || event.input || {},
            status: event.toolCall.state || 'pending',
          },
        }))
      )
    }

    case 'tool-call-progress': {
      // Append progress to the tool block's content
      const messageIndex = state.messages.findIndex(m =>
        m.blocks.some(b => b.metadata?.toolCallId === `${event.toolCallId}`)
      )
      if (messageIndex === -1) return state

      const message = state.messages[messageIndex]
      const toolBlock = message.blocks.find(b => b.metadata?.toolCallId === `${event.toolCallId}`)
      if (!toolBlock) return state

      return updateMessage(state, message.id, msg =>
        appendToBlock(msg, toolBlock.id, event.output ?? '')
      )
    }

    case 'tool-call-completed': {
      // Update the tool block with final output
      const messageIndex = state.messages.findIndex(m => m.promptId === event.toolCall.promptId)
      if (messageIndex === -1) return state

      const message = state.messages[messageIndex]
      const toolBlockId = event.toolCall.blockId

      if (!toolBlockId) return state

      return updateMessage(state, message.id, msg =>
        updateBlock(msg, toolBlockId, block => ({
          ...block,
          content: event.toolCall.output || block.content,
          metadata: {
            ...block.metadata,
            output: event.toolCall.output,
            status: 'completed',
          },
        }))
      )
    }

    case 'tool-call-failed': {
      // Update the tool block with error
      const messageIndex = state.messages.findIndex(m => m.promptId === event.toolCall.promptId)
      if (messageIndex === -1) return state

      const message = state.messages[messageIndex]
      const toolBlockId = event.toolCall.blockId

      if (!toolBlockId) return state

      return updateMessage(state, message.id, msg =>
        updateBlock(msg, toolBlockId, block => ({
          ...block,
          metadata: {
            ...block.metadata,
            error: event.error || event.toolCall.error,
            status: 'error',
          },
        }))
      )
    }

    case 'conversation-updated':
      return {
        ...state,
        conversation: {
          ...state.conversation,
          title: event.conversation.title ?? state.conversation.title,
          updatedAt: event.conversation.updatedAt,
        },
      }

    default:
      return state
  }
}

function toUiBlock(block: InternalBlock): Block {
  const base = {
    id: block.id.toString(),
    content: block.content,
  }

  if (block.type === 'tool_use' && block.metadata) {
    const meta = block.metadata as Record<string, unknown>
    return {
      ...base,
      type: 'tool_call',
      toolName: String(meta.toolName || 'unknown'),
      toolUseId: String(meta.toolUseId || block.id),
      toolCallId: String(meta.toolCallId || block.id),
      input: (meta.input as Record<string, unknown>) || {},
      output: meta.output || null,
      error: String(meta.error || ''),
    }
  }

  return {
    ...base,
    type: block.type as 'text' | 'thinking',
  }
}

function toUiMessage(message: InternalMessage): Message {
  return {
    id: message.id.toString(),
    type: message.role,
    blocks: message.blocks.map(toUiBlock),
    timestamp: message.createdAt,
  }
}

export function useConversationStream({
  conversationId,
  userId,
  client,
}: UseConversationStreamOptions): UseConversationStreamResult {
  const [internalState, setInternalState] = useState<InternalConversationState | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const iteratorRef = useRef<AsyncGenerator<ConversationStreamEvent> | null>(null)
  const activeEffectRef = useRef<number>(0)

  useEffect(() => {
    if (!conversationId || !userId) {
      setInternalState(null)
      setStatus('idle')
      setError(null)
      setIsStreaming(false)
      return
    }

    let cancelled = false
    const effectId = activeEffectRef.current + 1
    activeEffectRef.current = effectId

    const start = async () => {
      setStatus('loading')
      setError(null)
      setIsStreaming(false)

      try {
        const payload = await client.streamConversation(conversationId, userId)

        if (!payload) {
          if (cancelled || activeEffectRef.current !== effectId) return
          setInternalState(null)
          setStatus('error')
          setError('Conversation stream unavailable')
          return
        }

        if (cancelled || activeEffectRef.current !== effectId) {
          await payload.events.return({ value: undefined, done: true })
          return
        }

        iteratorRef.current = payload.events
        setInternalState(createInternalState(payload.snapshot))
        setStatus('ready')

        for await (const event of payload.events) {
          if (cancelled || activeEffectRef.current !== effectId) {
            break
          }
          setInternalState(prev => {
            if (!prev) return prev
            return applyEvent(prev, event)
          })
        }
      } catch (streamError) {
        if (cancelled || activeEffectRef.current !== effectId) return
        const message =
          streamError instanceof Error
            ? streamError.message
            : 'Failed to stream conversation'
        setError(message)
        setStatus('error')
        setIsStreaming(false)
      }
    }

    start()

    return () => {
      cancelled = true
      if (iteratorRef.current?.return) {
        void iteratorRef.current.return({ value: undefined, done: true })
      }
      iteratorRef.current = null
      setIsStreaming(false)
    }
  }, [conversationId, userId, client])

  useEffect(() => {
    if (!internalState) {
      setIsStreaming(false)
      return
    }

    const streaming = internalState.messages.some(message => {
      return message.role === 'assistant' && message.status === 'processing'
    })

    setIsStreaming(streaming)
  }, [internalState])

  const messages = useMemo(() => {
    if (!internalState) return []
    return internalState.messages.map(toUiMessage)
  }, [internalState])

  const conversation = internalState?.conversation ?? null

  return { status, conversation, messages, error, isStreaming }
}