import type { ConversationStreamClient } from '@/hooks/useConversationStream'
import type {
  ConversationSnapshot,
  ConversationStreamEvent,
  ConversationStreamPayload,
  SnapshotBlock,
  SnapshotMessage,
  SnapshotPrompt,
  SnapshotToolCall,
} from '@/types/streaming'
import {
  isConversationStreamEventType,
  type ConversationStreamEventType,
} from '../../../../types/conversationStream'

interface ServerConversationState {
  conversation: ServerConversation
  messages: ServerMessage[]
}

interface ServerConversation {
  id: number
  title: string | null
  createdAt: string | Date
  updatedAt: string | Date
  userId?: number
}

interface ServerMessage {
  id: number
  conversationId: number
  role: 'user' | 'assistant' | 'system'
  content: string | null
  status: string | null
  queueOrder: number | null
  createdAt: string | Date
  updatedAt: string | Date
  model?: string | null
  promptId?: number | null
  blocks?: ServerBlock[]
}

interface ServerBlock {
  id: number
  messageId: number
  type: SnapshotBlock['type']
  content: string | null
  order: number | null
  metadata?: Record<string, unknown> | null
  createdAt?: string | Date
  updatedAt?: string | Date
  toolCall?: ServerToolCall | null
}

interface ServerToolCall {
  id: number
  apiToolCallId?: string | null
  blockId: number | null
  promptId: number
  name: string
  state: string
  output: string | null
  input?: Record<string, unknown> | null
  error?: string | null
  createdAt: string | Date
  updatedAt: string | Date
  completedAt: string | Date | null
  providerExecuted?: boolean
  dynamic?: boolean
  startedAt?: string | Date | null
  timeoutAt?: string | Date | null
}

interface ServerPrompt {
  id: number
  conversationId: number
  messageId: number
  status: 'queued' | 'streaming' | 'completed' | 'failed'
  model: string
  createdAt: string | Date
  completedAt: string | Date | null
  error?: string | null
  systemMessage?: string | null
}

interface ServerStreamEvent {
  type: ConversationStreamEventType | string
  conversationId?: number
  message?: ServerMessage
  prompt?: ServerPrompt
  toolCall?: ServerToolCall
  promptId?: number
  messageId?: number
  blockId?: number
  blockType?: string
  content?: string
  delta?: string
  error?: string
  input?: Record<string, unknown>
  toolCallId?: number
  output?: string
}

interface AsyncEventStream<T> {
  iterator: AsyncGenerator<T>
  push: (event: T) => void
  close: () => void
  fail: (error: Error) => void
}

function resolveWebSocketUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4001/api'
  const url = new URL(apiUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.toString()
}

function toIso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString()
}

function toIsoOrNull(value: string | Date | null | undefined): string | null {
  if (value == null) return null
  return toIso(value)
}

function normalizeToolCall(toolCall: ServerToolCall): SnapshotToolCall {
  return {
    id: toolCall.id,
    apiToolCallId: toolCall.apiToolCallId ?? null,
    blockId: toolCall.blockId ?? null,
    promptId: toolCall.promptId,
    name: toolCall.name,
    state: toolCall.state,
    output: toolCall.output ?? null,
    input: toolCall.input ?? null,
    error: toolCall.error ?? null,
    createdAt: toIso(toolCall.createdAt),
    updatedAt: toIso(toolCall.updatedAt),
    completedAt: toIsoOrNull(toolCall.completedAt),
    providerExecuted: toolCall.providerExecuted,
    dynamic: toolCall.dynamic,
    startedAt: toIsoOrNull(toolCall.startedAt),
    timeoutAt: toIsoOrNull(toolCall.timeoutAt),
  }
}

function normalizeBlock(block: ServerBlock): SnapshotBlock {
  return {
    id: block.id,
    messageId: block.messageId,
    type: block.type,
    content: block.content ?? null,
    order: block.order ?? null,
    metadata: block.metadata ?? null,
    toolCall: block.toolCall ? normalizeToolCall(block.toolCall) : null,
  }
}

function normalizeMessage(message: ServerMessage): SnapshotMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content ?? null,
    createdAt: toIso(message.createdAt),
    updatedAt: toIso(message.updatedAt),
    status: (message.status as SnapshotMessage['status']) ?? null,
    promptId: message.promptId ?? null,
    model: message.model ?? null,
    blocks: message.blocks?.map(normalizeBlock) ?? [],
  }
}

function normalizePrompt(prompt: ServerPrompt): SnapshotPrompt {
  return {
    id: prompt.id,
    conversationId: prompt.conversationId,
    messageId: prompt.messageId,
    status: prompt.status,
    model: prompt.model,
    createdAt: toIso(prompt.createdAt),
    completedAt: toIsoOrNull(prompt.completedAt),
    systemMessage: prompt.systemMessage,
    error: prompt.error ?? null,
  }
}

function normalizeSnapshot(
  snapshot: ServerConversationState
): ConversationSnapshot {
  return {
    conversation: {
      id: snapshot.conversation.id,
      title: snapshot.conversation.title,
      createdAt: toIso(snapshot.conversation.createdAt),
      updatedAt: toIso(snapshot.conversation.updatedAt),
    },
    messages: snapshot.messages.map(normalizeMessage),
  }
}

function assert<T>(value: T | undefined | null, message: string): T {
  if (value == null) {
    throw new Error(message)
  }
  return value
}

function normalizeEvent(event: ServerStreamEvent): ConversationStreamEvent {
  if (!isConversationStreamEventType(event.type)) {
    throw new Error(`Unknown event type: ${event.type}`)
  }

  switch (event.type) {
    case 'message-created':
      return {
        type: 'message-created',
        message: normalizeMessage(
          assert(event.message, 'Missing message payload in stream event')
        ),
      }
    case 'message-updated':
      return {
        type: 'message-updated',
        message: normalizeMessage(
          assert(event.message, 'Missing message payload in stream event')
        ),
      }
    case 'prompt-started':
      return {
        type: 'prompt-started',
        prompt: normalizePrompt(
          assert(event.prompt, 'Missing prompt payload in stream event')
        ),
      }
    case 'prompt-completed':
      return {
        type: 'prompt-completed',
        prompt: normalizePrompt(
          assert(event.prompt, 'Missing prompt payload in stream event')
        ),
      }
    case 'prompt-failed':
      return {
        type: 'prompt-failed',
        prompt: normalizePrompt(
          assert(event.prompt, 'Missing prompt payload in stream event')
        ),
        error: event.error ?? null,
      }
    case 'block-start':
      return {
        type: 'block-start',
        promptId: assert(
          event.promptId,
          'Missing promptId in block_start event'
        ),
        messageId: assert(
          event.messageId,
          'Missing messageId in block_start event'
        ),
        blockId: assert(event.blockId, 'Missing blockId in block_start event'),
        blockType: event.blockType as SnapshotBlock['type'],
      }
    case 'block-delta':
      return {
        type: 'block-delta',
        promptId: assert(
          event.promptId,
          'Missing promptId in block_delta event'
        ),
        messageId: assert(
          event.messageId,
          'Missing messageId in block_delta event'
        ),
        blockId: assert(event.blockId, 'Missing blockId in block_delta event'),
        content: event.delta || event.content || '',
      }
    case 'block-end':
      return {
        type: 'block-end',
        promptId: assert(event.promptId, 'Missing promptId in block_end event'),
        messageId: assert(
          event.messageId,
          'Missing messageId in block_end event'
        ),
        blockId: assert(event.blockId, 'Missing blockId in block_end event'),
      }
    case 'tool-call-started':
      return {
        type: 'tool-call-started',
        toolCall: normalizeToolCall(
          assert(event.toolCall, 'Missing tool call payload in stream event')
        ),
        input: event.input ?? {},
      }
    case 'tool-call-progress':
      return {
        type: 'tool-call-progress',
        toolCallId: assert(
          event.toolCallId,
          'Missing toolCallId in tool_call_progress event'
        ),
        blockId: event.blockId ?? null,
        output: event.output || '',
      }
    case 'tool-call-completed':
      return {
        type: 'tool-call-completed',
        toolCall: normalizeToolCall(
          assert(event.toolCall, 'Missing tool call payload in stream event')
        ),
      }
    case 'tool-call-failed':
      return {
        type: 'tool-call-failed',
        toolCall: normalizeToolCall(
          assert(event.toolCall, 'Missing tool call payload in stream event')
        ),
        error: event.error ?? null,
      }
    default:
      throw new Error(`Unknown event type: ${event.type}`)
  }
}

function createAsyncEventStream<T>(onCancel: () => void): AsyncEventStream<T> {
  let queue: T[] = []
  let pendingResolvers: Array<(value: IteratorResult<T>) => void> = []
  let pendingRejectors: Array<(reason?: unknown) => void> = []
  let closed = false
  let failure: Error | null = null

  const iterator: AsyncGenerator<T> = {
    async next(): Promise<IteratorResult<T>> {
      if (failure) {
        return Promise.reject(failure)
      }

      if (queue.length > 0) {
        const value = queue.shift() as T
        return { value, done: false }
      }

      if (closed) {
        return {
          value: undefined as unknown as T,
          done: true,
        }
      }

      return new Promise<IteratorResult<T>>((resolve, reject) => {
        pendingResolvers.push(resolve)
        pendingRejectors.push(reject)
      })
    },

    async return(): Promise<IteratorResult<T>> {
      closed = true
      onCancel()
      queue = []
      while (pendingResolvers.length > 0) {
        const resolve = pendingResolvers.shift()
        pendingRejectors.shift()
        resolve?.({ value: undefined as unknown as T, done: true })
      }
      return { value: undefined as unknown as T, done: true }
    },

    async throw(error): Promise<IteratorResult<T>> {
      const err =
        error instanceof Error ? error : new Error(String(error ?? 'error'))
      failure = err
      onCancel()
      queue = []
      while (pendingRejectors.length > 0) {
        const reject = pendingRejectors.shift()
        pendingResolvers.shift()
        reject?.(err)
      }
      return Promise.reject(err)
    },

    [Symbol.asyncIterator]() {
      return this
    },

    async [Symbol.asyncDispose]() {
      await this.return({ value: undefined as unknown as T, done: true })
    },
  }

  return {
    iterator,
    push: (event: T) => {
      if (closed || failure) return
      if (pendingResolvers.length > 0) {
        const resolve = pendingResolvers.shift()
        pendingRejectors.shift()
        resolve?.({ value: event, done: false })
        return
      }
      queue.push(event)
    },
    close: () => {
      if (closed) return
      closed = true
      while (pendingResolvers.length > 0) {
        const resolve = pendingResolvers.shift()
        pendingRejectors.shift()
        resolve?.({ value: undefined as unknown as T, done: true })
      }
      queue = []
    },
    fail: (error: Error) => {
      void iterator.throw(error)
    },
  }
}

class WebSocketConversationStreamClient implements ConversationStreamClient {
  async streamConversation(
    conversationId: number,
    _userId: number
  ): Promise<ConversationStreamPayload | null> {
    if (!conversationId) {
      return null
    }

    const wsUrl = resolveWebSocketUrl()
    const socket = new WebSocket(wsUrl)
    const stream = createAsyncEventStream<ConversationStreamEvent>(() => {
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(1000, 'stream closed')
      }
    })

    return await new Promise((resolve, reject) => {
      let resolved = false
      let snapshotCache: ConversationSnapshot | null = null

      const errorHandler = (error: Error) => {
        if (!resolved) {
          reject(error)
        } else {
          stream.fail(error)
        }
      }

      const handleMessage = (event: MessageEvent) => {
        let payload: {
          type: string
          conversationId?: number
          snapshot?: ServerConversationState
          event?: ServerStreamEvent
          error?: string
        }

        try {
          payload = JSON.parse(event.data)
        } catch {
          errorHandler(new Error('Invalid message format'))
          return
        }

        if (
          payload.conversationId !== undefined &&
          payload.conversationId !== conversationId
        ) {
          return
        }

        switch (payload.type) {
          case 'subscribed':
            break
          case 'snapshot':
            if (!payload.snapshot) {
              errorHandler(new Error('Snapshot payload missing'))
              return
            }
            snapshotCache = normalizeSnapshot(payload.snapshot)
            if (!resolved) {
              resolved = true
              resolve({
                snapshot: snapshotCache,
                events: stream.iterator,
              })
            }
            break
          case 'event':
            if (!payload.event) return
            try {
              stream.push(normalizeEvent(payload.event as ServerStreamEvent))
            } catch (error) {
              console.error('Failed to normalize event', {
                error,
                event: payload.event,
              })
            }
            break
          case 'error': {
            const errorMessage =
              payload.error ?? 'Conversation stream encountered an error'
            errorHandler(new Error(errorMessage))
            break
          }
          default:
            break
        }
      }

      const handleOpen = () => {
        socket.send(
          JSON.stringify({
            type: 'subscribe',
            conversationId,
          })
        )
      }

      const handleClose = () => {
        if (!resolved) {
          reject(new Error('WebSocket closed before snapshot was received'))
        }
        stream.close()
        socket.removeEventListener('message', handleMessage)
        socket.removeEventListener('open', handleOpen)
        socket.removeEventListener('close', handleClose)
        socket.removeEventListener('error', handleSocketError)
      }

      const handleSocketError = () => {
        errorHandler(new Error('WebSocket connection error'))
      }

      socket.addEventListener('open', handleOpen)
      socket.addEventListener('message', handleMessage)
      socket.addEventListener('close', handleClose)
      socket.addEventListener('error', handleSocketError)
    })
  }
}

export const conversationStreamClient: ConversationStreamClient =
  new WebSocketConversationStreamClient()
