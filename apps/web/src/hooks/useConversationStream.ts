import { useEffect, useMemo, useRef, useState } from 'react'
import type { Message } from '@/types/conversation'
import type {
  ConversationSnapshot,
  ConversationStreamEvent,
  SnapshotBlock,
  SnapshotMessage,
  SnapshotConversation,
  ConversationStreamPayload,
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
}

interface InternalBlockState {
  id: number
  type: SnapshotBlock['type']
  content: string
}

interface InternalMessageState {
  id: number
  role: SnapshotMessage['role']
  createdAt: string
  updatedAt: string
  promptId?: number
  model?: string | null
  status?: SnapshotMessage['status']
  blocks: Map<number, InternalBlockState>
  blockOrder: number[]
}

interface InternalConversationState {
  conversation: SnapshotConversation
  messages: InternalMessageState[]
}

function createInternalBlock(block: SnapshotBlock): InternalBlockState {
  return {
    id: block.id,
    type: block.type,
    content: block.content ?? '',
  }
}

function normalizeBlockOrder(blocks: SnapshotBlock[] | undefined): number[] {
  if (!blocks || blocks.length === 0) return []
  return [...blocks]
    .sort((a, b) => {
      const aOrder = a.order ?? a.id
      const bOrder = b.order ?? b.id
      if (aOrder === bOrder) {
        return a.id - b.id
      }
      return aOrder - bOrder
    })
    .map(block => block.id)
}

function createInternalMessage(message: SnapshotMessage): InternalMessageState {
  const blocksArray = message.blocks ?? []
  const blockOrder = normalizeBlockOrder(blocksArray)
  const blocks = new Map<number, InternalBlockState>()
  for (const block of blocksArray) {
    blocks.set(block.id, createInternalBlock(block))
  }

  return {
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    promptId: message.promptId ?? undefined,
    model: message.model ?? null,
    status: message.status,
    blocks,
    blockOrder,
  }
}

function sortMessagesByCreatedAt(
  messages: SnapshotMessage[]
): SnapshotMessage[] {
  return messages.slice().sort((a, b) => {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

function sortInternalByCreatedAt(
  messages: InternalMessageState[]
): InternalMessageState[] {
  return messages.slice().sort((a, b) => {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

function createInternalState(
  snapshot: ConversationSnapshot
): InternalConversationState {
  const messages = sortMessagesByCreatedAt(snapshot.messages).map(message =>
    createInternalMessage(message)
  )

  return {
    conversation: snapshot.conversation,
    messages,
  }
}

function messageExists(
  state: InternalConversationState,
  messageId: number
): boolean {
  return state.messages.some(message => message.id === messageId)
}

function upsertMessage(
  state: InternalConversationState,
  incoming: SnapshotMessage
): InternalConversationState {
  if (!messageExists(state, incoming.id)) {
    const nextMessages = sortInternalByCreatedAt([
      ...state.messages,
      createInternalMessage(incoming),
    ])

    return { ...state, messages: nextMessages }
  }

  const nextMessages = state.messages.map(message => {
    if (message.id !== incoming.id) return message

    const nextBlocks = incoming.blocks
      ? new Map<number, InternalBlockState>(
          incoming.blocks.map(block => [block.id, createInternalBlock(block)])
        )
      : new Map(message.blocks)

    const nextBlockOrder = incoming.blocks
      ? normalizeBlockOrder(incoming.blocks)
      : [...message.blockOrder]

    return {
      ...message,
      updatedAt: incoming.updatedAt,
      status: incoming.status ?? message.status,
      promptId:
        incoming.promptId != null ? incoming.promptId : message.promptId,
      model: incoming.model ?? message.model,
      blocks: nextBlocks,
      blockOrder: nextBlockOrder,
    }
  })

  return { ...state, messages: nextMessages }
}

function updateMessage(
  state: InternalConversationState,
  messageId: number,
  updater: (message: InternalMessageState) => InternalMessageState
): InternalConversationState {
  const index = state.messages.findIndex(message => message.id === messageId)
  if (index === -1) {
    return state
  }

  const target = state.messages[index]
  const updated = updater(target)
  if (updated === target) {
    return state
  }

  const nextMessages = state.messages.slice()
  nextMessages[index] = updated
  return { ...state, messages: nextMessages }
}

function ensureBlock(
  message: InternalMessageState,
  blockId: number,
  blockType: SnapshotBlock['type']
): InternalMessageState {
  if (message.blocks.has(blockId)) {
    return message
  }

  const nextBlocks = new Map(message.blocks)
  nextBlocks.set(blockId, {
    id: blockId,
    type: blockType,
    content: '',
  })

  const nextBlockOrder = message.blockOrder.includes(blockId)
    ? message.blockOrder
    : [...message.blockOrder, blockId]

  return {
    ...message,
    blocks: nextBlocks,
    blockOrder: nextBlockOrder,
  }
}

function appendToBlock(
  message: InternalMessageState,
  blockId: number,
  delta: string,
  blockType: SnapshotBlock['type'] = 'text'
): InternalMessageState {
  const existing = message.blocks.get(blockId)
  if (!existing) {
    return ensureBlock(message, blockId, blockType)
  }

  const nextBlocks = new Map(message.blocks)
  nextBlocks.set(blockId, {
    ...existing,
    content: existing.content + delta,
  })

  return {
    ...message,
    blocks: nextBlocks,
  }
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
        ensureBlock(message, event.blockId, event.blockType)
      )
    }
    case 'block-delta': {
      return updateMessage(state, event.messageId, message =>
        appendToBlock(message, event.blockId, event.content)
      )
    }
    case 'block-end':
    case 'prompt-started':
    case 'prompt-completed':
    case 'prompt-failed':
    case 'tool-call-started':
    case 'tool-call-progress':
    case 'tool-call-completed':
    case 'tool-call-failed':
      return state
    default:
      return state
  }
}

function toUiMessage(message: InternalMessageState): Message {
  const blocks = message.blockOrder
    .map(blockId => message.blocks.get(blockId))
    .filter((block): block is InternalBlockState => Boolean(block))

  const textContent = blocks
    .filter(block => block.type === 'text')
    .map(block => block.content)
    .join('')

  const metadataEntries: Array<[string, number | string]> = []
  if (message.promptId != null) {
    metadataEntries.push(['promptId', message.promptId])
  }
  if (message.model) {
    metadataEntries.push(['model', message.model])
  }

  const metadata =
    metadataEntries.length > 0 ? Object.fromEntries(metadataEntries) : undefined

  return {
    id: message.id.toString(),
    type: message.role,
    content: textContent,
    timestamp: message.createdAt,
    metadata,
  }
}

export function useConversationStream({
  conversationId,
  userId,
  client,
}: UseConversationStreamOptions): UseConversationStreamResult {
  const [internalState, setInternalState] =
    useState<InternalConversationState | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  )
  const [error, setError] = useState<string | null>(null)
  const iteratorRef = useRef<AsyncGenerator<ConversationStreamEvent> | null>(null)
  const activeEffectRef = useRef<number>(0)

  useEffect(() => {
    if (!conversationId || !userId) {
      setInternalState(null)
      setStatus('idle')
      setError(null)
      return
    }

    let cancelled = false
    const effectId = activeEffectRef.current + 1
    activeEffectRef.current = effectId

    const start = async () => {
      setStatus('loading')
      setError(null)

      try {
        const payload = await client.streamConversation(
          conversationId,
          userId
        )

        if (!payload) {
          if (cancelled || activeEffectRef.current !== effectId) return
          setInternalState(null)
          setStatus('error')
          setError('Conversation stream unavailable')
          return
        }

        if (cancelled || activeEffectRef.current !== effectId) {
          await payload.events.return?.()
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
      }
    }

    start()

    return () => {
      cancelled = true
      if (iteratorRef.current?.return) {
        void iteratorRef.current.return()
      }
      iteratorRef.current = null
    }
  }, [conversationId, userId, client])

  const messages = useMemo(() => {
    if (!internalState) return []
    return internalState.messages.map(message => toUiMessage(message))
  }, [internalState])

  const conversation = internalState?.conversation ?? null

  return { status, conversation, messages, error }
}
