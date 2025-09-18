import { act } from '@testing-library/react'
import type {
  ConversationSnapshot,
  ConversationStreamEvent,
  ConversationStreamPayload,
} from '@/types/streaming'

type StreamControllerResult = {
  iterator: AsyncGenerator<ConversationStreamEvent>
  emit: (event: ConversationStreamEvent) => void
  close: () => void
}

function createStreamController(): StreamControllerResult {
  let buffer: ConversationStreamEvent[] = []
  let waiters: Array<
    (result: IteratorResult<ConversationStreamEvent>) => void
  > = []
  let closed = false

  const iterator: AsyncGenerator<ConversationStreamEvent> = {
    async next() {
      if (buffer.length > 0) {
        const value = buffer.shift() as ConversationStreamEvent
        return { value, done: false }
      }

      if (closed) {
        return {
          value: undefined as unknown as ConversationStreamEvent,
          done: true,
        }
      }

      return new Promise(resolve => {
        waiters.push(resolve)
      })
    },

    async return(value?: any) {
      closed = true
      while (waiters.length > 0) {
        const resolve = waiters.shift()
        resolve?.({
          value: value ?? (undefined as unknown as ConversationStreamEvent),
          done: true,
        })
      }
      buffer = []
      return {
        value: value ?? (undefined as unknown as ConversationStreamEvent),
        done: true,
      }
    },

    async throw(error) {
      closed = true
      waiters.forEach(resolve => {
        resolve({
          value: undefined as unknown as ConversationStreamEvent,
          done: true,
        })
      })
      waiters = []
      buffer = []
      return Promise.reject(error)
    },

    [Symbol.asyncIterator]() {
      return this
    },

    async [Symbol.asyncDispose]() {
      await this.return(undefined)
    },
  }

  const emit = (event: ConversationStreamEvent) => {
    if (closed) return
    const resolve = waiters.shift()
    if (resolve) {
      resolve({ value: event, done: false })
      return
    }
    buffer.push(event)
  }

  const close = () => {
    if (closed) return
    closed = true
    while (waiters.length > 0) {
      const resolve = waiters.shift()
      resolve?.({
        value: undefined as unknown as ConversationStreamEvent,
        done: true,
      })
    }
    buffer = []
  }

  return { iterator, emit, close }
}

export function createStreamServiceStub(snapshot: ConversationSnapshot): {
  payload: ConversationStreamPayload
  emit: (event: ConversationStreamEvent) => Promise<void>
  close: () => Promise<void>
} {
  const controller = createStreamController()

  const payload: ConversationStreamPayload = {
    snapshot,
    events: controller.iterator,
  }

  const emit = async (event: ConversationStreamEvent) => {
    await act(async () => {
      controller.emit(event)
      await Promise.resolve()
    })
  }

  const close = async () => {
    await act(async () => {
      controller.close()
      await Promise.resolve()
    })
  }

  return { payload, emit, close }
}
