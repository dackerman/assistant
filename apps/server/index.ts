import { createServer } from 'node:http'
import Anthropic from '@anthropic-ai/sdk'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { RawData, WebSocket } from 'ws'
import { WebSocketServer } from 'ws'
import 'dotenv/config'

import { db as defaultDb } from './src/db'
import { BashSessionManager } from './src/services/bashSessionManager'
import type {
  ConversationState,
  ConversationStreamEvent,
} from './src/services/conversationService'
import { ConversationService } from './src/services/conversationService'
import { PromptService } from './src/services/promptService'
import { TitleService } from './src/services/titleService'
import { ToolExecutorService } from './src/services/toolExecutorService'
import { createBashTool } from './src/services/tools/bashTool'
import { createSdkLogger, logger } from './src/utils/logger'

if (process.listenerCount('unhandledRejection') === 0) {
  process.on('unhandledRejection', reason => {
    if (reason instanceof Error) {
      logger.error('Unhandled promise rejection', reason)
    } else {
      logger.error('Unhandled promise rejection', { reason })
    }
  })
}

if (process.listenerCount('uncaughtException') === 0) {
  process.on('uncaughtException', error => {
    logger.error('Uncaught exception', error)
  })
}

const app = new Hono()

const anthropicApiKey = process.env.ANTHROPIC_API_KEY
if (!anthropicApiKey) {
  throw new Error('ANTHROPIC_API_KEY is not set')
}

// Initialize services
const anthropicSdkLogger = logger.child({ service: 'AnthropicSDK' })

const anthropic = new Anthropic({
  apiKey: anthropicApiKey,
  logLevel: 'debug',
  logger: createSdkLogger(anthropicSdkLogger),
})

const bashSessionManager = new BashSessionManager()
const toolExecutorService = new ToolExecutorService(defaultDb, [
  createBashTool(bashSessionManager),
])
toolExecutorService.initialize()

const promptService = new PromptService(undefined, {
  anthropicClient: anthropic,
  toolExecutor: toolExecutorService,
})

const titleService = new TitleService(
  anthropic,
  logger.child({ service: 'TitleService' })
)

const conversationService = new ConversationService(undefined, {
  promptService,
  titleService,
})

// Enable CORS for frontend
app.use(
  '*',
  cors({
    origin: [
      'http://localhost:4000',
      'http://127.0.0.1:4000',
      'http://0.0.0.0:4000',
      'http://homoiconicity:4000',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
)

// Constants for supported models
const SUPPORTED_MODELS = {
  SONNET_4: 'claude-sonnet-4-20250514',
  OPUS_4_1: 'claude-opus-4-1-20250805',
} as const

const DEFAULT_MODEL = SUPPORTED_MODELS.SONNET_4

// API routes
app.get('/api/health', c => {
  return c.json({
    status: 'ok',
    message: 'Server is running',
    providers: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
    },
    supportedModels: Object.values(SUPPORTED_MODELS),
    defaultModel: DEFAULT_MODEL,
  })
})

// Conversation endpoints
app.post('/api/conversations', async c => {
  // TODO: Get userId from auth
  const userId = 1 // Hardcoded for now

  const body = await c.req.json()
  const conversationId = await conversationService.createConversation(
    userId,
    body.title
  )

  return c.json({ id: conversationId })
})

app.get('/api/conversations/:id', async c => {
  const conversationId = Number.parseInt(c.req.param('id'), 10)
  const userId = 1 // TODO: Get from auth

  const conversation = await conversationService.getConversation(
    conversationId,
    userId
  )

  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404)
  }

  return c.json(conversation)
})

app.get('/api/conversations/:id/stream', async c => {
  const conversationId = Number.parseInt(c.req.param('id'), 10)

  const activeStream = await conversationService.getActiveStream(conversationId)

  return c.json({ activeStream })
})

app.post('/api/conversations/:id/messages', async c => {
  const conversationId = Number.parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  // Validate model if provided
  const model = body.model || DEFAULT_MODEL
  if (!Object.values(SUPPORTED_MODELS).includes(model)) {
    return c.json(
      {
        error: 'Unsupported model',
        supportedModels: Object.values(SUPPORTED_MODELS),
      },
      400
    )
  }

  const result = await conversationService.createUserMessage(
    conversationId,
    body.content
  )

  return c.json(result)
})

app.get('/api/conversations', async c => {
  const userId = 1 // TODO: Get from auth

  const conversations = await conversationService.listConversations(userId)

  return c.json({ conversations })
})

app.delete('/api/conversations/:id', async c => {
  const conversationId = Number.parseInt(c.req.param('id'), 10)
  const userId = 1 // TODO: Get from auth

  try {
    await conversationService.deleteConversation(conversationId, userId)
    return c.json({ success: true })
  } catch (error) {
    console.error('Failed to delete conversation:', error)
    return c.json({ error: 'Failed to delete conversation' }, 500)
  }
})

app.put('/api/conversations/:id', async c => {
  const conversationId = Number.parseInt(c.req.param('id'), 10)
  const userId = 1 // TODO: Get from auth

  try {
    const body = await c.req.json()
    const { title } = body

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return c.json({ error: 'Title is required' }, 400)
    }

    // Verify the user owns this conversation by trying to get it first
    const conversation = await conversationService.getConversation(
      conversationId,
      userId
    )
    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404)
    }

    await conversationService.setTitle(conversationId, title.trim())
    return c.json({ success: true })
  } catch (error) {
    console.error('Failed to update conversation title:', error)
    return c.json({ error: 'Failed to update title' }, 500)
  }
})

// Serve static files for production (when frontend is built)
app.get('*', c => {
  return c.text(
    'API Server - Frontend should be served separately in development'
  )
})

const port = process.env.PORT || 4001

// Create HTTP server that serves both HTTP and WebSocket
const server = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('Bad Request: Missing URL')
    return
  }
  const url = new URL(req.url, `http://${req.headers.host}`)
  const request = new Request(url.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body:
      req.method !== 'GET' && req.method !== 'HEAD'
        ? new ReadableStream({
            start(controller) {
              req.on('data', chunk => controller.enqueue(chunk))
              req.on('end', () => controller.close())
              req.on('error', err => controller.error(err))
            },
          })
        : undefined,
    duplex: req.method !== 'GET' && req.method !== 'HEAD' ? 'half' : undefined,
  })

  try {
    const response = await app.fetch(request)

    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })

    if (response.body) {
      const reader = response.body.getReader()
      const pump = () => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              res.end()
              return
            }
            res.write(value)
            pump()
          })
          .catch(err => {
            console.error('Stream error:', err)
            res.end()
          })
      }
      pump()
    } else {
      res.end()
    }
  } catch (error) {
    console.error('Server error:', error)
    res.statusCode = 500
    res.end('Internal Server Error')
  }
})

// Create WebSocket server
const wss = new WebSocketServer({ server })

type OutgoingMessage =
  | { type: 'subscribed'; conversationId: number }
  | {
      type: 'snapshot'
      conversationId: number
      snapshot: ConversationState
    }
  | {
      type: 'event'
      conversationId: number
      event: ConversationStreamEvent
    }
  | { type: 'error'; conversationId: number | null; error: string }

interface ActiveSubscription {
  iterator: AsyncGenerator<ConversationStreamEvent>
  cancelled: boolean
}

const subscriptionRegistry = new Map<
  WebSocket,
  Map<number, ActiveSubscription>
>()

function getSubscriptionMap(ws: WebSocket) {
  let map = subscriptionRegistry.get(ws)
  if (!map) {
    map = new Map()
    subscriptionRegistry.set(ws, map)
  }
  return map
}

async function closeSubscription(
  ws: WebSocket,
  conversationId: number,
  wsLogger: ReturnType<typeof logger.child>
) {
  const map = subscriptionRegistry.get(ws)
  const subscription = map?.get(conversationId)
  if (!map || !subscription || subscription.cancelled) {
    return
  }

  subscription.cancelled = true

  try {
    await subscription.iterator.return?.(undefined)
  } catch (error) {
    wsLogger.error('Failed to close conversation stream iterator', {
      conversationId,
      error,
    })
  }

  map.delete(conversationId)
  if (map.size === 0) {
    subscriptionRegistry.delete(ws)
  }
}

async function closeAllSubscriptions(
  ws: WebSocket,
  wsLogger: ReturnType<typeof logger.child>
) {
  const map = subscriptionRegistry.get(ws)
  if (!map) return

  const conversationIds = Array.from(map.keys())
  wsLogger.wsEvent('connection_cleanup', {
    conversationsCount: conversationIds.length,
    conversationIds,
  })

  await Promise.all(
    conversationIds.map(conversationId =>
      closeSubscription(ws, conversationId, wsLogger)
    )
  )
}

function send(
  ws: WebSocket,
  wsLogger: ReturnType<typeof logger.child>,
  payload: OutgoingMessage
) {
  if (ws.readyState !== ws.OPEN) return
  wsLogger.wsEvent('outgoing_message', { payload })
  ws.send(JSON.stringify(payload))
}

wss.on('connection', (ws: WebSocket) => {
  const wsId = Math.random().toString(36).substring(7)
  const wsLogger = logger.child({ wsClientId: wsId })
  wsLogger.wsEvent('connection_established')

  ws.on('message', async (data: RawData) => {
    const rawMessage = data.toString()
    wsLogger.wsEvent('incoming_message', { raw: rawMessage })
    try {
      const raw = JSON.parse(rawMessage) as {
        type: string
        conversationId?: number
      }

      if (raw.type !== 'subscribe') {
        wsLogger.wsEvent('unknown_message', { receivedType: raw.type })
        return
      }

      const conversationId = Number(raw.conversationId)
      if (!Number.isFinite(conversationId)) {
        send(ws, wsLogger, {
          type: 'error',
          conversationId: null,
          error: 'Invalid conversation id',
        })
        return
      }

      wsLogger.wsEvent('subscription_request', { conversationId })

      await closeSubscription(ws, conversationId, wsLogger)

      const stream = await conversationService.streamConversation(
        conversationId,
        1
      )

      if (!stream) {
        send(ws, wsLogger, {
          type: 'error',
          conversationId,
          error: 'Conversation not found',
        })
        return
      }

      send(ws, wsLogger, { type: 'subscribed', conversationId })
      send(ws, wsLogger, {
        type: 'snapshot',
        conversationId,
        snapshot: stream.snapshot,
      })

      const subscription: ActiveSubscription = {
        iterator: stream.events,
        cancelled: false,
      }

      const map = getSubscriptionMap(ws)
      map.set(conversationId, subscription)

      wsLogger.wsEvent('subscription_confirmed', { conversationId })

      void (async () => {
        try {
          for await (const event of stream.events) {
            if (subscription.cancelled) {
              break
            }

            send(ws, wsLogger, {
              type: 'event',
              conversationId,
              event,
            })
          }
        } catch (error) {
          wsLogger.error('Failed to forward conversation events', {
            conversationId,
            error,
          })
          send(ws, wsLogger, {
            type: 'error',
            conversationId,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to stream conversation',
          })
        } finally {
          const activeMap = subscriptionRegistry.get(ws)
          if (activeMap?.get(conversationId) === subscription) {
            activeMap.delete(conversationId)
            if (activeMap.size === 0) {
              subscriptionRegistry.delete(ws)
            }
          }
        }
      })()
    } catch (error) {
      wsLogger.error('WebSocket message handling error', error)
      send(ws, wsLogger, {
        type: 'error',
        conversationId: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  ws.on('close', () => {
    void closeAllSubscriptions(ws, wsLogger)
    wsLogger.wsEvent('connection_closed')
  })

  ws.on('error', error => {
    wsLogger.error('WebSocket connection error', error)
  })
})

logger.info('Server starting up', {
  port,
  nodeEnv: process.env.NODE_ENV,
  anthropicApiKey: !!process.env.ANTHROPIC_API_KEY,
  supportedModels: Object.values(SUPPORTED_MODELS),
  defaultModel: DEFAULT_MODEL,
})

// Log the file being used for this server run (if file logging is enabled)
if (process.env.LOG_TO_FILE === 'true') {
  const logDir = process.env.LOG_DIR || 'logs'
  logger.info('File logging enabled', {
    logDirectory: logDir,
    logFile: `Logs will be written to ${logDir}/app-{timestamp}.log`,
    note: 'Each server run creates a unique log file with timestamp',
  })
}

server.listen(Number(port), '0.0.0.0', () => {
  logger.info('Server ready', {
    httpUrl: `http://0.0.0.0:${port}`,
    wsUrl: `ws://0.0.0.0:${port}`,
    port: Number(port),
  })
})
