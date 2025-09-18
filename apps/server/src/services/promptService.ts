import type Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParamsStreaming } from '@anthropic-ai/sdk/resources/messages.js'
import { and, eq, or } from 'drizzle-orm'
import postgres from 'postgres'
import type { DB } from '../db'
import { db as defaultDb } from '../db'
import {
  type Block,
  type BlockType,
  blocks,
  messages,
  type NewBlock,
  type NewPrompt,
  type NewPromptEvent,
  type NewToolCall,
  promptEvents,
  prompts,
  toolCalls,
} from '../db/schema'
import { AsyncEventQueue } from '../utils/asyncEventQueue'
import { Logger } from '../utils/logger'
import { type ToolDefinition, ToolExecutorService } from './toolExecutorService'

// Types for tool handling
type ToolInput = Record<string, unknown>
type ToolResult = {
  tool_use_id: string
  content: string
}

// Type for tool data during streaming
interface ToolData {
  blockId: number
  toolName: string
  toolUseId: string
  input: string
}

export interface StreamPromptOptions {
  includeExistingBlocks?: boolean
}

export type PromptStreamEvent =
  | { type: 'prompt-created'; promptId: number }
  | { type: 'block-start'; blockId: number; blockType: BlockType }
  | { type: 'block-delta'; blockId: number; content: string }
  | { type: 'block-end'; blockId: number }

type PromptStreamNotification = {
  type: 'block_start' | 'block_delta' | 'block_end'
  promptId: number
  conversationId: number
  messageId: number
  blockId: number
  blockType: BlockType
  delta?: string
}

export interface CreatePromptParams {
  conversationId: number
  messageId: number
  model?: string
  systemMessage?: string
  maxTokens?: number
}

export interface StreamingCallbacks {
  onPromptCreated?: (promptId: number) => Promise<void> | void
  onBlockStart?: (blockId: number, type: string) => Promise<void> | void
  onBlockDelta?: (blockId: number, content: string) => Promise<void> | void
  onBlockEnd?: (blockId: number) => Promise<void> | void
  onToolStart?: (
    toolCallId: number,
    name: string,
    input: ToolInput
  ) => Promise<void> | void
  onToolProgress?: (toolCallId: number, output: string) => Promise<void> | void
  onToolEnd?: (
    toolCallId: number,
    output: string,
    success: boolean
  ) => Promise<void> | void
  onComplete?: (promptId: number) => Promise<void> | void
  onError?: (promptId: number | null, error: Error) => Promise<void> | void
}

interface PromptServiceOptions {
  anthropicClient?: Anthropic
  toolExecutor?: ToolExecutorService
  tools?: ToolDefinition[]
  logger?: Logger
}

/**
 * PromptService handles individual prompts to LLM and manages streaming responses.
 * It creates and updates blocks during streaming and handles tool execution.
 * This is now called internally by ConversationService.
 */
export class PromptService {
  private client?: Anthropic
  private db: DB
  private logger: Logger
  private toolExecutor: ToolExecutorService

  constructor(dbInstance: DB = defaultDb, options: PromptServiceOptions = {}) {
    this.db = dbInstance
    this.logger = options.logger ?? new Logger({ service: 'PromptService' })
    if (options.toolExecutor) {
      this.toolExecutor = options.toolExecutor
    } else {
      const tools = options.tools ?? []
      this.toolExecutor = new ToolExecutorService(dbInstance, tools)
    }
    this.client = options.anthropicClient
  }

  private async getAnthropicClient(): Promise<Anthropic> {
    if (!this.client) {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      this.client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      })
    }
    return this.client
  }

  /**
   * Create and stream a prompt, updating blocks in real-time
   */
  async createAndStreamPrompt(
    params: CreatePromptParams,
    callbacks?: StreamingCallbacks
  ): Promise<number> {
    const {
      conversationId,
      messageId,
      model = 'claude-sonnet-4-20250514',
      systemMessage,
      maxTokens = 50000,
    } = params

    this.logger.info('Creating and streaming prompt', {
      conversationId,
      messageId,
      model,
    })

    // Build conversation history for this prompt
    const history = await this.buildConversationHistory(conversationId)

    const request: MessageCreateParamsStreaming = {
      model,
      max_tokens: maxTokens,
      stream: true,
      system: systemMessage,
      messages: history,
      tools: [
        {
          name: 'bash',
          description:
            'Execute bash commands in a persistent shell session. Use this to run any command line operations, check files, install packages, etc.',
          input_schema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'The bash command to execute',
              },
            },
            required: ['command'],
          },
        },
      ],
    }

    // Create prompt record
    const [prompt] = await this.db
      .insert(prompts)
      .values({
        conversationId,
        messageId,
        status: 'streaming',
        model,
        systemMessage,
        request: request as unknown,
      } as NewPrompt)
      .returning()

    if (!prompt) {
      throw new Error('Failed to create prompt')
    }
    const promptId = prompt.id

    await callbacks?.onPromptCreated?.(promptId)

    try {
      await this.streamPromptResponse(promptId, request, callbacks)
      return promptId
    } catch (error) {
      // Mark prompt as failed
      await this.db
        .update(prompts)
        .set({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
        .where(eq(prompts.id, promptId))

      const normalizedError =
        error instanceof Error ? error : new Error(String(error))

      await callbacks?.onError?.(promptId, normalizedError)
      throw error
    }
  }

  async streamPrompt(promptId: number, options: StreamPromptOptions = {}) {
    const includeExistingBlocks = options.includeExistingBlocks ?? true

    const [prompt] = await this.db
      .select()
      .from(prompts)
      .where(eq(prompts.id, promptId))

    if (!prompt) {
      return null
    }

    const streamingBlocks = await this.db
      .select()
      .from(blocks)
      .where(eq(blocks.messageId, prompt.messageId))
      .orderBy(blocks.order)

    const queue = new AsyncEventQueue<PromptStreamEvent>()
    queue.push({ type: 'prompt-created', promptId: prompt.id })

    const connectionString = this.getConnectionString()
    let sqlClient: ReturnType<typeof postgres> | null = null

    if (!connectionString) {
      this.logger.warn('No database connection string for prompt streaming', {
        promptId,
      })
      queue.close()
    } else {
      try {
        sqlClient = postgres(connectionString, { max: 1 })
        await sqlClient.listen('prompt_stream_events', (payload: string) => {
          try {
            const data = JSON.parse(payload) as PromptStreamNotification
            if (data.promptId !== prompt.id) return

            switch (data.type) {
              case 'block_start': {
                queue.push({
                  type: 'block-start',
                  blockId: data.blockId,
                  blockType: data.blockType,
                })
                break
              }
              case 'block_delta': {
                if (data.delta) {
                  queue.push({
                    type: 'block-delta',
                    blockId: data.blockId,
                    content: data.delta,
                  })
                }
                break
              }
              case 'block_end': {
                queue.push({
                  type: 'block-end',
                  blockId: data.blockId,
                })
                break
              }
            }
          } catch (error) {
            this.logger.error('Failed to parse prompt stream notification', {
              error,
              payload,
            })
          }
        })
      } catch (error) {
        this.logger.error('Failed to subscribe to prompt stream events', {
          error,
          promptId: prompt.id,
        })
        queue.close()
        if (sqlClient) {
          try {
            await sqlClient.end({ timeout: 5 })
          } catch (closeError) {
            this.logger.error('Failed to close prompt event client', {
              error: closeError,
            })
          }
        }
        sqlClient = null
      }
    }

    if (includeExistingBlocks) {
      for (const block of streamingBlocks) {
        queue.push({
          type: 'block-start',
          blockId: block.id,
          blockType: block.type,
        })
        if (block.type === 'text' && block.content) {
          queue.push({
            type: 'block-delta',
            blockId: block.id,
            content: block.content,
          })
        }
        queue.push({ type: 'block-end', blockId: block.id })
      }
    }

    const service = this
    const events = (async function* (): AsyncGenerator<PromptStreamEvent> {
      try {
        while (true) {
          const { value, done } = await queue.next()
          if (done) {
            return
          }
          yield value
        }
      } finally {
        queue.close()
        if (sqlClient) {
          try {
            await sqlClient.end({ timeout: 5 })
          } catch (error) {
            if (error instanceof Error) {
              service.logger.error('Failed to close prompt event client', {
                error,
                promptId: prompt.id,
              })
            }
          }
        }
      }
    })()

    return {
      prompt,
      blocks: streamingBlocks,
      events,
    }
  }

  /**
   * Stream the prompt response and handle tool calls
   */
  private async streamPromptResponse(
    promptId: number,
    request: MessageCreateParamsStreaming,
    callbacks?: StreamingCallbacks
  ): Promise<void> {
    const client = await this.getAnthropicClient()
    let currentRequest = request
    const toolCallResults: ToolResult[] = []

    // Keep looping until no more tool calls are needed
    while (true) {
      const stream = await client.messages.create(currentRequest)
      const { hasToolCalls, newToolResults } = await this.handleStreamEvents(
        promptId,
        stream,
        callbacks
      )

      if (!hasToolCalls) {
        // No tools called, we're done
        await this.completePrompt(promptId, callbacks)
        break
      }

      // Wait for all tool calls to complete
      await this.waitForToolCallsToComplete(promptId)

      // Build continuation request with tool results
      toolCallResults.push(...newToolResults)
      currentRequest = {
        ...request,
        messages: [
          ...request.messages,
          ...toolCallResults.map(result => ({
            role: 'user' as const,
            content: [
              {
                type: 'tool_result' as const,
                tool_use_id: result.tool_use_id,
                content: result.content,
              },
            ],
          })),
        ],
      }
    }
  }

  /**
   * Handle streaming events from Anthropic
   */
  private async handleStreamEvents(
    promptId: number,
    stream: AsyncIterable<Anthropic.Messages.RawMessageStreamEvent>,
    callbacks?: StreamingCallbacks
  ): Promise<{ hasToolCalls: boolean; newToolResults: ToolResult[] }> {
    const blockMap = new Map<number, number>() // stream index -> block id
    const toolInputs = new Map<number, ToolData>() // stream index -> tool data
    const toolResults: ToolResult[] = []
    let hasToolCalls = false

    try {
      for await (const event of stream) {
        // Store raw event
        await this.db.insert(promptEvents).values({
          promptId,
          type: event.type,
          data: event as unknown,
        } as NewPromptEvent)

        switch (event.type) {
          case 'content_block_start': {
            if (event.content_block.type === 'text') {
              // Create text block
              const [block] = await this.db
                .insert(blocks)
                .values({
                  messageId: await this.getMessageIdForPrompt(promptId),
                  type: 'text',
                  content: '',
                  order: event.index,
                } as NewBlock)
                .returning()

              if (block) {
                blockMap.set(event.index, block.id)
                await callbacks?.onBlockStart?.(block.id, 'text')
              }
            } else if (event.content_block.type === 'tool_use') {
              hasToolCalls = true

              // Create tool_use block
              const [block] = await this.db
                .insert(blocks)
                .values({
                  messageId: await this.getMessageIdForPrompt(promptId),
                  type: 'tool_use',
                  content: `Using ${event.content_block.name} tool...`,
                  order: event.index,
                  metadata: {
                    toolName: event.content_block.name,
                    toolUseId: event.content_block.id,
                  },
                } as NewBlock)
                .returning()

              if (block) {
                blockMap.set(event.index, block.id)
                toolInputs.set(event.index, {
                  blockId: block.id,
                  toolName: event.content_block.name,
                  toolUseId: event.content_block.id,
                  input: '',
                })

                await callbacks?.onBlockStart?.(block.id, 'tool_use')
                if (block.content) {
                  await callbacks?.onBlockDelta?.(block.id, block.content)
                }
              }
            }
            break
          }

          case 'content_block_delta': {
            const blockId = blockMap.get(event.index)
            if (!blockId) break

            if (event.delta.type === 'text_delta') {
              // Update text block
              await this.updateBlockContent(blockId, event.delta.text, true)
              await callbacks?.onBlockDelta?.(blockId, event.delta.text)
            } else if (event.delta.type === 'input_json_delta') {
              // Accumulate tool input
              const toolData = toolInputs.get(event.index)
              if (toolData) {
                toolData.input += event.delta.partial_json
              }
            }
            break
          }

          case 'content_block_stop': {
            const blockId = blockMap.get(event.index)
            if (!blockId) break

            const toolData = toolInputs.get(event.index)
            if (toolData) {
              // Tool call complete - start execution
              try {
                const parsedInput = JSON.parse(toolData.input)

                // Create tool call record
                const [toolCall] = await this.db
                  .insert(toolCalls)
                  .values({
                    promptId,
                    blockId,
                    apiToolCallId: toolData.toolUseId,
                    name: toolData.toolName,
                    input: parsedInput,
                    state: 'pending',
                  } as NewToolCall)
                  .returning()

                if (toolCall) {
                  await callbacks?.onToolStart?.(
                    toolCall.id,
                    toolData.toolName,
                    parsedInput
                  )

                  let latestOutput = ''
                  try {
                    // Start tool execution
                    await this.toolExecutor.executeToolCall(toolCall.id, {
                      onChunk: async chunk => {
                        await callbacks?.onToolProgress?.(toolCall.id, chunk)
                      },
                      onResult: async output => {
                        latestOutput = output
                      },
                    })
                  } catch (error) {
                    const [failedTool] = await this.db
                      .select()
                      .from(toolCalls)
                      .where(eq(toolCalls.id, toolCall.id))

                    const failureOutput =
                      failedTool?.error ||
                      (error instanceof Error ? error.message : String(error))

                    await callbacks?.onToolEnd?.(
                      toolCall.id,
                      failureOutput,
                      false
                    )
                    throw error
                  }

                  // Get the result for continuation
                  const [completedTool] = await this.db
                    .select()
                    .from(toolCalls)
                    .where(eq(toolCalls.id, toolCall.id))

                  if (completedTool) {
                    const outputText =
                      latestOutput || completedTool.output || ''

                    toolResults.push({
                      tool_use_id: toolData.toolUseId,
                      content: outputText || 'No output',
                    })

                    await callbacks?.onToolEnd?.(
                      toolCall.id,
                      outputText,
                      completedTool.state === 'completed'
                    )
                  }
                }
              } catch (error) {
                this.logger.error('Error parsing tool input', {
                  error,
                  input: toolData.input,
                })
              }
            }

            await callbacks?.onBlockEnd?.(blockId)
            break
          }

          case 'message_stop': {
            // Stream completed
            break
          }
        }
      }
    } catch (error) {
      this.logger.error('Error handling stream events', { promptId, error })
      throw error
    }

    return { hasToolCalls, newToolResults: toolResults }
  }

  /**
   * Update block content (append if incremental)
   */
  private async updateBlockContent(
    blockId: number,
    content: string,
    append = false
  ): Promise<void> {
    if (append) {
      // Get current content and append
      const [currentBlock] = await this.db
        .select({ content: blocks.content })
        .from(blocks)
        .where(eq(blocks.id, blockId))

      const newContent = (currentBlock?.content || '') + content

      await this.db
        .update(blocks)
        .set({ content: newContent, updatedAt: new Date() })
        .where(eq(blocks.id, blockId))
    } else {
      await this.db
        .update(blocks)
        .set({ content, updatedAt: new Date() })
        .where(eq(blocks.id, blockId))
    }
  }

  /**
   * Wait for all tool calls to complete
   */
  private async waitForToolCallsToComplete(promptId: number): Promise<void> {
    while (true) {
      const activeCalls = await this.db
        .select()
        .from(toolCalls)
        .where(
          and(
            eq(toolCalls.promptId, promptId),
            or(eq(toolCalls.state, 'pending'), eq(toolCalls.state, 'executing'))
          )
        )

      if (activeCalls.length === 0) break

      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  /**
   * Mark prompt as completed
   */
  private async completePrompt(
    promptId: number,
    callbacks?: StreamingCallbacks
  ): Promise<void> {
    await this.db
      .update(prompts)
      .set({
        status: 'completed',
        completedAt: new Date(),
      })
      .where(eq(prompts.id, promptId))

    await callbacks?.onComplete?.(promptId)

    this.logger.info('Prompt completed', { promptId })
  }

  /**
   * Get message ID for a prompt
   */
  private async getMessageIdForPrompt(promptId: number): Promise<number> {
    const [prompt] = await this.db
      .select({ messageId: prompts.messageId })
      .from(prompts)
      .where(eq(prompts.id, promptId))

    if (!prompt) {
      throw new Error(`Prompt ${promptId} not found`)
    }
    return prompt.messageId
  }

  /**
   * Build conversation history for prompt
   */
  private async buildConversationHistory(
    conversationId: number
  ): Promise<Anthropic.Messages.MessageParam[]> {
    // Get all completed messages with their blocks
    const messagesWithBlocks = await this.db
      .select({
        message: messages,
        block: blocks,
      })
      .from(messages)
      .leftJoin(blocks, eq(messages.id, blocks.messageId))
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.status, 'completed')
        )
      )
      .orderBy(messages.createdAt, blocks.order)

    // Group by messages
    const messageMap = new Map()
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

    // Convert to Anthropic format
    const history: Anthropic.Messages.MessageParam[] = []

    for (const message of messageMap.values()) {
      if (message.role === 'user') {
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

  private getConnectionString(): string | undefined {
    if (process.env.NODE_ENV === 'test') {
      return process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
    }
    return process.env.DATABASE_URL
  }
}
