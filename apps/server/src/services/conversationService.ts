import { and, asc, desc, eq } from 'drizzle-orm'
import postgres from 'postgres'
import { db as defaultDb } from '../db'
import type { Conversation, DB, Prompt, ToolCall } from '../db'
import {
  type Block,
  type BlockType,
  type Message,
  type NewBlock,
  type NewConversation,
  type NewMessage,
  blocks,
  conversations,
  messages,
  prompts,
  toolCalls,
} from '../db/schema'
import { AsyncEventQueue } from '../utils/asyncEventQueue'
import { Logger } from '../utils/logger'
import { PromptService } from './promptService'

export interface ConversationState {
  conversation: Conversation
  messages: (Message & { blocks: (Block & { toolCall?: ToolCall })[] })[]
}

type MessageNotificationPayload = {
  id: number
  conversationId: number
  role: Message['role']
  content: string | null
  status: Message['status']
  queueOrder: number | null
  createdAt: string
  updatedAt: string
}

type PromptNotificationPayload = {
  id: number
  conversationId: number
  messageId: number
  status: Prompt['status']
  model: string
  systemMessage?: string | null
  createdAt: string
  completedAt?: string | null
  error?: string | null
}

type ConversationNotification =
  | {
      type: 'message_created' | 'message_updated'
      conversationId: number
      message: MessageNotificationPayload
    }
  | {
      type: 'prompt_started' | 'prompt_completed' | 'prompt_failed'
      conversationId: number
      prompt: PromptNotificationPayload
      error?: string | null
    }
  | {
      type: 'block_start' | 'block_delta' | 'block_end'
      conversationId: number
      promptId: number
      messageId: number
      blockId: number
      blockType?: BlockType
      delta?: string
    }

export type ConversationStreamEvent =
  | { type: 'message-created'; message: Message }
  | { type: 'message-updated'; message: Message }
  | { type: 'prompt-started'; prompt: Prompt }
  | { type: 'prompt-completed'; prompt: Prompt }
  | { type: 'prompt-failed'; prompt: Prompt; error?: string | null }
  | {
      type: 'block-start'
      promptId: number
      messageId: number
      blockId: number
      blockType: BlockType
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
      toolCall: ToolCall
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
      toolCall: ToolCall
    }
  | {
      type: 'tool-call-failed'
      toolCall: ToolCall
      error: string | null
    }

interface ConversationServiceOptions {
  promptService?: PromptService
  logger?: Logger
}

export class ConversationService {
  private db: DB
  private logger: Logger
  private promptService: PromptService
  private conversationStreams = new Map<
    number,
    Set<AsyncEventQueue<ConversationStreamEvent>>
  >()

  constructor(
    dbInstance: DB = defaultDb,
    options: ConversationServiceOptions = {}
  ) {
    this.db = dbInstance
    this.logger =
      options.logger ?? new Logger({ service: 'ConversationService' })
    this.promptService = options.promptService ?? new PromptService(dbInstance)
  }

  private addConversationStream(
    conversationId: number,
    queue: AsyncEventQueue<ConversationStreamEvent>
  ) {
    const listeners = this.conversationStreams.get(conversationId) ?? new Set()
    listeners.add(queue)
    this.conversationStreams.set(conversationId, listeners)
  }

  private removeConversationStream(
    conversationId: number,
    queue: AsyncEventQueue<ConversationStreamEvent>
  ) {
    const listeners = this.conversationStreams.get(conversationId)
    if (!listeners) return
    listeners.delete(queue)
    if (listeners.size === 0) {
      this.conversationStreams.delete(conversationId)
    }
  }

  private broadcastConversationEvent(
    conversationId: number,
    event: ConversationStreamEvent
  ) {
    const listeners = this.conversationStreams.get(conversationId)
    if (!listeners) return
    for (const queue of listeners) {
      queue.push(event)
    }
  }

  /**
   * Create a new conversation
   */
  async createConversation(userId: number, title?: string): Promise<number> {
    const [conversation] = await this.db
      .insert(conversations)
      .values({
        userId,
        title: title || 'New Conversation',
      } as NewConversation)
      .returning()

    this.logger.info('Created new conversation', {
      conversationId: conversation?.id,
      userId,
      title,
    })

    if (!conversation) {
      throw new Error('Failed to create conversation')
    }
    return conversation.id
  }

  /**
   * Get conversation with all messages and blocks (includes queued messages)
   */
  async getConversation(
    conversationId: number,
    userId: number
  ): Promise<ConversationState | null> {
    // Get conversation
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId)
        )
      )

    if (!conversation) {
      return null
    }

    // Get all messages (completed and queued) with their blocks
    const messagesWithBlocks = await this.db
      .select({
        message: messages,
        block: blocks,
      })
      .from(messages)
      .leftJoin(blocks, eq(messages.id, blocks.messageId))
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt, messages.queueOrder, blocks.order)

    // Group blocks by message
    const messageMap = new Map<
      number,
      Message & { blocks: (Block & { toolCall?: ToolCall })[] }
    >()
    for (const row of messagesWithBlocks) {
      if (!messageMap.has(row.message.id)) {
        messageMap.set(row.message.id, {
          ...row.message,
          blocks: [],
        })
      }
      if (row.block) {
        messageMap.get(row.message.id)?.blocks.push(row.block)
      }
    }

    // Get tool calls for all blocks in this conversation
    const conversationToolCalls = await this.db
      .select({
        toolCall: toolCalls,
        blockId: toolCalls.blockId,
      })
      .from(toolCalls)
      .innerJoin(blocks, eq(toolCalls.blockId, blocks.id))
      .innerJoin(messages, eq(blocks.messageId, messages.id))
      .where(eq(messages.conversationId, conversationId))
      .orderBy(toolCalls.id)

    // Attach tool calls to blocks
    const toolCallsByBlockId = new Map<number, ToolCall>()
    for (const row of conversationToolCalls) {
      if (row.blockId) {
        toolCallsByBlockId.set(row.blockId, row.toolCall)
      }
    }

    for (const message of messageMap.values()) {
      for (const block of message.blocks) {
        if (toolCallsByBlockId.has(block.id)) {
          block.toolCall = toolCallsByBlockId.get(block.id)
        }
      }
    }

    return {
      conversation,
      messages: Array.from(messageMap.values()),
    }
  }

  /**
   * Get the currently active prompt for a conversation
   */
  async getActivePrompt(conversationId: number) {
    const [activePrompt] = await this.db
      .select()
      .from(prompts)
      .where(
        and(
          eq(prompts.conversationId, conversationId),
          eq(prompts.status, 'streaming')
        )
      )
      .orderBy(desc(prompts.createdAt))
      .limit(1)

    return activePrompt || null
  }

  /**
   * Queue a user message for processing
   */
  async queueMessage(conversationId: number, content: string): Promise<number> {
    // Get the highest queue order for this conversation
    const [lastQueued] = await this.db
      .select({ queueOrder: messages.queueOrder })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.status, 'queued')
        )
      )
      .orderBy(desc(messages.queueOrder))
      .limit(1)

    const nextQueueOrder = (lastQueued?.queueOrder || 0) + 1

    const [message] = await this.db
      .insert(messages)
      .values({
        conversationId,
        role: 'user',
        content,
        status: 'queued',
        queueOrder: nextQueueOrder,
      } as NewMessage)
      .returning()

    this.logger.info('Queued user message', {
      conversationId,
      messageId: message?.id,
      queueOrder: nextQueueOrder,
      contentLength: content.length,
    })

    // If no active prompt, start processing the queue
    const activePrompt = await this.getActivePrompt(conversationId)
    if (!activePrompt) {
      await this.processQueue(conversationId)
    }

    if (!message) {
      throw new Error('Failed to create message')
    }
    return message.id
  }

  /**
   * Edit a queued message (only allowed if not yet processing)
   */
  async editQueuedMessage(
    messageId: number,
    content: string
  ): Promise<boolean> {
    const result = await this.db
      .update(messages)
      .set({ content, updatedAt: new Date() })
      .where(and(eq(messages.id, messageId), eq(messages.status, 'queued')))
      .returning()

    this.logger.info('Edited queued message', {
      messageId,
      contentLength: content.length,
    })

    return result.length > 0
  }

  /**
   * Delete a queued message
   */
  async deleteQueuedMessage(messageId: number): Promise<boolean> {
    const result = await this.db
      .delete(messages)
      .where(and(eq(messages.id, messageId), eq(messages.status, 'queued')))
      .returning()

    this.logger.info('Deleted queued message', { messageId })
    return result.length > 0
  }

  /**
   * Process the next queued message
   */
  async processQueue(conversationId: number): Promise<void> {
    // Check if there's already an active prompt
    const activePrompt = await this.getActivePrompt(conversationId)
    if (activePrompt) {
      this.logger.info('Cannot process queue - active prompt exists', {
        conversationId,
        activePromptId: activePrompt.id,
      })
      return
    }

    // Get the next queued message
    const [nextMessage] = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.status, 'queued')
        )
      )
      .orderBy(asc(messages.queueOrder))
      .limit(1)

    if (!nextMessage) {
      this.logger.info('No queued messages to process', { conversationId })
      return
    }

    this.logger.info('Processing next queued message', {
      conversationId,
      messageId: nextMessage.id,
      queueOrder: nextMessage.queueOrder,
    })

    const { assistantMessageId } = await this.db.transaction(async tx => {
      // Update message status to processing
      await tx
        .update(messages)
        .set({ status: 'processing', updatedAt: new Date() })
        .where(eq(messages.id, nextMessage.id))

      // Create assistant message for the response
      const [assistantMessage] = await tx
        .insert(messages)
        .values({
          conversationId,
          role: 'assistant',
          status: 'processing',
        } as NewMessage)
        .returning()

      if (!assistantMessage) {
        throw new Error('Failed to create assistant message')
      }

      // Create a text block for the user message
      await tx.insert(blocks).values({
        messageId: nextMessage.id,
        type: 'text',
        content: nextMessage.content,
        order: 0,
      } as NewBlock)

      // Mark user message as completed so it appears in history
      await tx
        .update(messages)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(messages.id, nextMessage.id))

      // Update conversation's updated timestamp
      await tx
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId))

      return { assistantMessageId: assistantMessage.id }
    })

    if (!assistantMessageId) {
      this.logger.error('Assistant message missing after queue processing', {
        conversationId,
        messageId: nextMessage.id,
      })
      return
    }

    try {
      let currentPromptId: number | null = null

      await this.promptService.createAndStreamPrompt(
        {
          conversationId,
          messageId: assistantMessageId,
          model: 'claude-sonnet-4-20250514',
          systemMessage: this.getSystemMessage(),
        },
        {
          onPromptCreated: async promptId => {
            currentPromptId = promptId
            await this.handlePromptCreated(conversationId, promptId)
          },
          onBlockStart: async (blockId, blockType) => {
            const [blockRecord] = await this.db
              .select({ messageId: blocks.messageId })
              .from(blocks)
              .where(eq(blocks.id, blockId))

            const promptId =
              currentPromptId ??
              (await this.findPromptIdForMessage(
                blockRecord?.messageId ?? null
              ))

            if (!promptId || !blockRecord) return

            this.broadcastConversationEvent(conversationId, {
              type: 'block-start',
              promptId,
              messageId: blockRecord.messageId,
              blockId,
              blockType: blockType as BlockType,
            })
          },
          onBlockDelta: async (blockId, content) => {
            const [blockRecord] = await this.db
              .select({ messageId: blocks.messageId })
              .from(blocks)
              .where(eq(blocks.id, blockId))

            const promptId =
              currentPromptId ??
              (await this.findPromptIdForMessage(
                blockRecord?.messageId ?? null
              ))

            if (!promptId || !blockRecord) return

            this.broadcastConversationEvent(conversationId, {
              type: 'block-delta',
              promptId,
              messageId: blockRecord.messageId,
              blockId,
              content,
            })
          },
          onBlockEnd: async blockId => {
            const [blockRecord] = await this.db
              .select({ messageId: blocks.messageId })
              .from(blocks)
              .where(eq(blocks.id, blockId))

            const promptId =
              currentPromptId ??
              (await this.findPromptIdForMessage(
                blockRecord?.messageId ?? null
              ))

            if (!promptId || !blockRecord) return

            this.broadcastConversationEvent(conversationId, {
              type: 'block-end',
              promptId,
              messageId: blockRecord.messageId,
              blockId,
            })
          },
          onToolStart: async (toolCallId, _name, input) => {
            const record = await this.getToolCallWithPrompt(toolCallId)
            if (!record || record.prompt.conversationId !== conversationId) {
              return
            }

            this.broadcastConversationEvent(conversationId, {
              type: 'tool-call-started',
              toolCall: record.toolCall,
              input,
            })
          },
          onToolProgress: async (toolCallId, output) => {
            const record = await this.getToolCallWithPrompt(toolCallId)
            if (!record || record.prompt.conversationId !== conversationId) {
              return
            }

            this.broadcastConversationEvent(conversationId, {
              type: 'tool-call-progress',
              toolCallId: record.toolCall.id,
              blockId: record.toolCall.blockId ?? null,
              output,
            })
          },
          onToolEnd: async (toolCallId, output, success) => {
            const record = await this.getToolCallWithPrompt(toolCallId)
            if (!record || record.prompt.conversationId !== conversationId) {
              return
            }

            if (!success) {
              this.broadcastConversationEvent(conversationId, {
                type: 'tool-call-failed',
                toolCall: record.toolCall,
                error: output || record.toolCall.error || null,
              })
              return
            }

            this.broadcastConversationEvent(conversationId, {
              type: 'tool-call-completed',
              toolCall: record.toolCall,
            })
          },
          onComplete: async promptId => {
            await this.handlePromptComplete(
              conversationId,
              assistantMessageId,
              promptId
            )
          },
          onError: async (promptId, error) => {
            await this.handlePromptError(
              conversationId,
              nextMessage.id,
              assistantMessageId,
              promptId,
              error
            )
          },
        }
      )
    } catch (error) {
      this.logger.error('Prompt streaming failed', {
        conversationId,
        userMessageId: nextMessage.id,
        assistantMessageId,
        error,
      })
      throw error
    }
  }

  private async getToolCallWithPrompt(toolCallId: number) {
    const [record] = await this.db
      .select({ toolCall: toolCalls, prompt: prompts })
      .from(toolCalls)
      .innerJoin(prompts, eq(toolCalls.promptId, prompts.id))
      .where(eq(toolCalls.id, toolCallId))
      .limit(1)

    return record ?? null
  }

  /**
   * Mark a message as completed and process next in queue
   */
  async completeMessage(messageId: number): Promise<void> {
    await this.db.transaction(async tx => {
      // Get the message to find its conversation
      const [message] = await tx
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))

      if (!message) return

      // Update message status
      await tx
        .update(messages)
        .set({ status: 'completed' })
        .where(eq(messages.id, messageId))

      // Clear active prompt from conversation
      await tx
        .update(conversations)
        .set({ activePromptId: null, updatedAt: new Date() })
        .where(eq(conversations.id, message.conversationId))

      this.logger.info('Completed message', {
        messageId,
        conversationId: message.conversationId,
      })
    })

    // Process next in queue if any
    const [message] = await this.db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))

    if (message) {
      await this.processQueue(message.conversationId)
    }
  }

  /**
   * Create a block within a message
   */
  async createBlock(
    messageId: number,
    type: string,
    content: string,
    metadata?: unknown
  ): Promise<number> {
    // Get the current highest order for this message
    const [lastBlock] = await this.db
      .select({ order: blocks.order })
      .from(blocks)
      .where(eq(blocks.messageId, messageId))
      .orderBy(desc(blocks.order))
      .limit(1)

    const nextOrder = (lastBlock?.order || -1) + 1

    const [block] = await this.db
      .insert(blocks)
      .values({
        messageId,
        type: type as BlockType,
        content,
        order: nextOrder,
        metadata,
      } as NewBlock)
      .returning()

    if (!block) {
      throw new Error('Failed to create block')
    }
    return block.id
  }

  /**
   * Update a block's content
   */
  async updateBlock(
    blockId: number,
    content: string,
    metadata?: unknown
  ): Promise<void> {
    await this.db
      .update(blocks)
      .set({
        content,
        metadata,
        updatedAt: new Date(),
      })
      .where(eq(blocks.id, blockId))
  }

  /**
   * List conversations for a user
   */
  async listConversations(userId: number) {
    return await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.updatedAt))
  }

  /**
   * Set conversation title
   */
  async setTitle(conversationId: number, title: string): Promise<void> {
    await this.db
      .update(conversations)
      .set({ title, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
  }

  /**
   * Delete a conversation and all associated data
   */
  async deleteConversation(
    conversationId: number,
    userId: number
  ): Promise<void> {
    // Verify the user owns this conversation
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId)
        )
      )

    if (!conversation) {
      throw new Error('Conversation not found or access denied')
    }

    // Delete the conversation (cascading deletes will handle related data)
    await this.db
      .delete(conversations)
      .where(eq(conversations.id, conversationId))

    this.logger.info('Conversation deleted', {
      conversationId,
      userId,
      title: conversation.title,
    })
  }

  /**
   * Build conversation history for AI model
   */
  async buildConversationHistory(conversationId: number, userId: number) {
    const result = await this.getConversation(conversationId, userId)
    if (!result) return []

    const history = []

    // Only include completed messages in the history
    const completedMessages = result.messages.filter(
      (msg: Message) => msg.status === 'completed'
    )

    for (const message of completedMessages) {
      if (message.role === 'user') {
        // User message - combine all text blocks
        const content = message.blocks
          .filter((b: Block) => b.type === 'text')
          .map((b: Block) => b.content)
          .join('')

        if (content) {
          history.push({
            role: 'user',
            content,
          })
        }
      } else if (message.role === 'assistant') {
        // Assistant message - only include text blocks (not thinking/tool_use)
        const content = message.blocks
          .filter((b: Block) => b.type === 'text')
          .map((b: Block) => b.content)
          .join('')

        if (content) {
          history.push({
            role: 'assistant',
            content,
          })
        }
      }
    }

    return history
  }

  /**
   * Get active streaming state for a conversation (compatibility method)
   */
  async getActiveStream(conversationId: number) {
    const activePrompt = await this.getActivePrompt(conversationId)
    if (!activePrompt) {
      return null
    }

    // Get blocks for the active prompt's message
    const streamingBlocks = await this.db
      .select()
      .from(blocks)
      .where(eq(blocks.messageId, activePrompt.messageId))
      .orderBy(blocks.order)

    return {
      prompt: activePrompt,
      blocks: streamingBlocks,
    }
  }

  async streamConversation(
    conversationId: number,
    userId: number
  ): Promise<{
    snapshot: ConversationState
    events: AsyncGenerator<ConversationStreamEvent>
  } | null> {
    const queue = new AsyncEventQueue<ConversationStreamEvent>()
    let sqlClient: ReturnType<typeof postgres> | null = null
    let cleanedUp = false

    this.addConversationStream(conversationId, queue)

    const cleanup = async () => {
      if (cleanedUp) return
      cleanedUp = true
      this.removeConversationStream(conversationId, queue)
      queue.close()
      if (sqlClient) {
        try {
          await sqlClient.end({ timeout: 5 })
        } catch (error) {
          if (error instanceof Error) {
            this.logger.error('Failed to close conversation stream client', {
              error,
              conversationId,
            })
          }
        }
        sqlClient = null
      }
    }

    const connectionString = this.getConnectionString()

    if (!connectionString) {
      this.logger.warn('Conversation streaming disabled - no database URL', {
        conversationId,
      })
      queue.close()
    } else {
      try {
        sqlClient = postgres(connectionString, { max: 1 })
        await sqlClient.listen('conversation_events', (payload: string) => {
          try {
            const data = JSON.parse(payload) as ConversationNotification
            if (data.conversationId !== conversationId) return

            switch (data.type) {
              case 'message_created': {
                const message = this.normalizeMessageNotification(data.message)
                this.broadcastConversationEvent(conversationId, {
                  type: 'message-created',
                  message,
                })
                break
              }
              case 'message_updated': {
                const message = this.normalizeMessageNotification(data.message)
                this.broadcastConversationEvent(conversationId, {
                  type: 'message-updated',
                  message,
                })
                break
              }
              case 'prompt_started': {
                const prompt = this.normalizePromptNotification(data.prompt)
                this.broadcastConversationEvent(conversationId, {
                  type: 'prompt-started',
                  prompt,
                })
                break
              }
              case 'prompt_completed': {
                const prompt = this.normalizePromptNotification(data.prompt)
                this.broadcastConversationEvent(conversationId, {
                  type: 'prompt-completed',
                  prompt,
                })
                break
              }
              case 'prompt_failed': {
                const prompt = this.normalizePromptNotification(data.prompt)
                this.broadcastConversationEvent(conversationId, {
                  type: 'prompt-failed',
                  prompt,
                  error: data.error ?? prompt.error,
                })
                break
              }
              case 'block_start': {
                this.broadcastConversationEvent(conversationId, {
                  type: 'block-start',
                  promptId: data.promptId,
                  messageId: data.messageId,
                  blockId: data.blockId,
                  blockType: data.blockType ?? 'text',
                })
                break
              }
              case 'block_delta': {
                if (data.delta) {
                  this.broadcastConversationEvent(conversationId, {
                    type: 'block-delta',
                    promptId: data.promptId,
                    messageId: data.messageId,
                    blockId: data.blockId,
                    content: data.delta,
                  })
                }
                break
              }
              case 'block_end': {
                this.broadcastConversationEvent(conversationId, {
                  type: 'block-end',
                  promptId: data.promptId,
                  messageId: data.messageId,
                  blockId: data.blockId,
                })
                break
              }
            }
          } catch (error) {
            if (error instanceof Error) {
              this.logger.error('Failed to parse conversation event', {
                error,
                payload,
                conversationId,
              })
            }
          }
        })
      } catch (error) {
        if (error instanceof Error) {
          this.logger.error('Failed to subscribe to conversation events', {
            error,
            conversationId,
          })
        }
        queue.close()
      }
    }

    const snapshot = await this.getConversation(conversationId, userId)
    if (!snapshot) {
      await cleanup()
      return null
    }

    const activeStream = await this.getActiveStream(conversationId)
    if (activeStream) {
      this.broadcastConversationEvent(conversationId, {
        type: 'prompt-started',
        prompt: activeStream.prompt,
      })
      for (const block of activeStream.blocks) {
        this.broadcastConversationEvent(conversationId, {
          type: 'block-start',
          promptId: activeStream.prompt.id,
          messageId: block.messageId,
          blockId: block.id,
          blockType: block.type,
        })
        if (block.type === 'text' && block.content) {
          this.broadcastConversationEvent(conversationId, {
            type: 'block-delta',
            promptId: activeStream.prompt.id,
            messageId: block.messageId,
            blockId: block.id,
            content: block.content,
          })
        }
      }
    }

    const events = (async function* () {
      try {
        while (true) {
          const { value, done } = await queue.next()
          if (done) {
            return
          }
          yield value
        }
      } finally {
        await cleanup()
      }
    })()

    return {
      snapshot,
      events,
    }
  }

  /**
   * Create user message and start assistant response (compatibility method)
   */
  async createUserMessage(
    conversationId: number,
    content: string,
    model = 'claude-sonnet-4-20250514'
  ): Promise<{ userMessageId: number; promptId: number }> {
    // Queue the message and get the response
    const userMessageId = await this.queueMessage(conversationId, content)

    // Get the active prompt that should have been created
    const activePrompt = await this.getActivePrompt(conversationId)

    return {
      userMessageId,
      promptId: activePrompt?.id || 0, // Fallback for compatibility
    }
  }

  /**
   * Get prompt by ID (compatibility method)
   */
  async getPromptById(promptId: number) {
    const [prompt] = await this.db
      .select()
      .from(prompts)
      .where(eq(prompts.id, promptId))

    return prompt || null
  }

  /**
   * Get the system message for prompts
   */
  private getSystemMessage(): string {
    return `You are a helpful assistant with access to a bash terminal. When users ask you to:
- List files or directories
- Run commands  
- Check system information
- Execute scripts
- Perform any system operations

Use the bash tool to execute the appropriate commands. Always explain what you're doing and show the results to the user.

For example:
- "list files" or "what files are here" → use bash tool with "ls" command
- "current directory" → use bash tool with "pwd" command  
- "check disk space" → use bash tool with "df -h" command

Execute the commands and then explain the results in a helpful way.`
  }

  private normalizeMessageNotification(
    payload: MessageNotificationPayload
  ): Message {
    return {
      id: payload.id,
      conversationId: payload.conversationId,
      role: payload.role,
      content: payload.content ?? null,
      status: payload.status,
      queueOrder: payload.queueOrder ?? null,
      createdAt: new Date(payload.createdAt),
      updatedAt: new Date(payload.updatedAt),
    } as Message
  }

  private normalizePromptNotification(
    payload: PromptNotificationPayload
  ): Prompt {
    return {
      id: payload.id,
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      status: payload.status,
      model: payload.model,
      systemMessage: payload.systemMessage ?? null,
      request: null,
      response: null,
      error: payload.error ?? null,
      createdAt: new Date(payload.createdAt),
      completedAt: payload.completedAt ? new Date(payload.completedAt) : null,
    } as Prompt
  }

  private getConnectionString(): string | undefined {
    if (process.env.NODE_ENV === 'test') {
      return process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
    }
    return process.env.DATABASE_URL
  }

  private async findPromptIdForMessage(
    messageId: number | null
  ): Promise<number | null> {
    if (!messageId) return null

    const [prompt] = await this.db
      .select({ id: prompts.id })
      .from(prompts)
      .where(eq(prompts.messageId, messageId))
      .orderBy(desc(prompts.createdAt))
      .limit(1)

    return prompt?.id ?? null
  }

  private async handlePromptCreated(
    conversationId: number,
    promptId: number
  ): Promise<void> {
    await this.db
      .update(conversations)
      .set({ activePromptId: promptId, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))

    this.logger.info('Prompt created', {
      conversationId,
      promptId,
    })
  }

  private async handlePromptComplete(
    conversationId: number,
    assistantMessageId: number,
    promptId: number
  ): Promise<void> {
    await this.db.transaction(async tx => {
      await tx
        .update(messages)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(messages.id, assistantMessageId))

      await tx
        .update(conversations)
        .set({ activePromptId: null, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId))
    })

    this.logger.info('Prompt completed', {
      conversationId,
      promptId,
      assistantMessageId,
    })

    this.processQueue(conversationId).catch(err => {
      this.logger.error('Failed to process next queued message', {
        conversationId,
        error: err,
      })
    })
  }

  private async handlePromptError(
    conversationId: number,
    userMessageId: number,
    assistantMessageId: number,
    promptId: number | null,
    error: Error
  ): Promise<void> {
    await this.db.transaction(async tx => {
      await tx
        .update(messages)
        .set({ status: 'queued', updatedAt: new Date() })
        .where(eq(messages.id, userMessageId))

      await tx
        .update(messages)
        .set({ status: 'error', updatedAt: new Date() })
        .where(eq(messages.id, assistantMessageId))

      await tx
        .update(conversations)
        .set({ activePromptId: null, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId))
    })

    this.logger.error('Prompt failed', {
      conversationId,
      userMessageId,
      assistantMessageId,
      promptId,
      error,
    })
  }
}
