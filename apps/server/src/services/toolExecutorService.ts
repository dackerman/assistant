import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { DB } from '../db'
import { db as defaultDb } from '../db'
import {
  blocks,
  prompts,
  type ToolCall,
  type ToolState,
  toolCalls,
} from '../db/schema'
import { Logger } from '../utils/logger'
import { sanitizeShellOutput } from '../utils/sanitize'

export type ToolStreamEvent =
  | { type: 'chunk'; chunk: string }
  | { type: 'result'; output?: string; metadata?: Record<string, unknown> }
  | { type: 'error'; error: unknown }

export interface ToolExecutionContext<TInput> {
  input: TInput
  toolCall: ToolCall
  conversationId: number
  logger: Logger
}

export interface ToolDefinition<TInput = unknown> {
  name: string
  description?: string
  inputSchema: z.ZodType<TInput>
  execute(
    context: ToolExecutionContext<TInput>
  ): AsyncIterable<ToolStreamEvent> | AsyncGenerator<ToolStreamEvent>
}

export interface ToolExecutionHandlers {
  onChunk?: (chunk: string) => Promise<void> | void
  onResult?: (output: string) => Promise<void> | void
  onError?: (error: string) => Promise<void> | void
}

export interface ToolExecutorConfig {
  timeout?: number
}

export class ToolExecutorService {
  private db: DB
  private logger: Logger
  private tools: Map<string, ToolDefinition<unknown>>

  constructor(
    dbInstance: DB = defaultDb,
    tools: ToolDefinition<unknown>[],
    config: ToolExecutorConfig = {}
  ) {
    const timeout = config.timeout || 300000

    this.db = dbInstance
    this.logger = new Logger({ service: 'ToolExecutorService' })
    this.tools = new Map(tools.map(tool => [tool.name, tool]))
  }

  async initialize(): Promise<void> {
    this.logger.info('ToolExecutorService initialized')
  }

  async executeToolCall(
    toolCallId: number,
    handlers?: ToolExecutionHandlers
  ): Promise<void> {
    const [toolCall] = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.id, toolCallId))

    if (!toolCall) {
      throw new Error(`Tool call ${toolCallId} not found`)
    }

    if (toolCall.state !== 'pending') {
      this.logger.info('Tool call not in pending state', {
        toolCallId,
        currentState: toolCall.state,
      })
      return
    }

    const toolDefinition = this.tools.get(toolCall.name)
    if (!toolDefinition) {
      await this.failToolCall(toolCall, `Unsupported tool: ${toolCall.name}`)
      await handlers?.onError?.(`Unsupported tool: ${toolCall.name}`)
      return
    }

    let parsedInput: unknown
    try {
      parsedInput = toolDefinition.inputSchema.parse(toolCall.input)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.failToolCall(toolCall, message)
      await handlers?.onError?.(message)
      return
    }

    await this.updateToolCallState(toolCallId, 'executing')

    const prompt = await this.getPromptForToolCall(toolCall)
    const context: ToolExecutionContext<unknown> = {
      input: parsedInput,
      toolCall,
      conversationId: prompt.conversationId,
      logger: this.logger.child({ tool: toolCall.name, toolCallId }),
    }

    let collectedOutput = ''
    let blockInitialized = false
    let resultHandled = false

    try {
      for await (const event of toolDefinition.execute(context)) {
        if (event.type === 'chunk') {
          const cleanChunk = sanitizeShellOutput(event.chunk)
          collectedOutput += cleanChunk
          await this.appendToolOutput(toolCall, cleanChunk)
          if (toolCall.blockId) {
            await this.updateToolResultBlock(
              toolCall.blockId,
              cleanChunk,
              blockInitialized,
              toolCall
            )
            blockInitialized = true
          }
          await handlers?.onChunk?.(cleanChunk)
          continue
        }

        if (event.type === 'result') {
          if (event.output !== undefined) {
            collectedOutput = sanitizeShellOutput(event.output)
          }
          resultHandled = true
          await handlers?.onResult?.(collectedOutput)
          continue
        }

        if (event.type === 'error') {
          throw event.error instanceof Error
            ? event.error
            : new Error(String(event.error))
        }
      }

      if (!resultHandled) {
        await handlers?.onResult?.(collectedOutput)
      }

      await this.setToolOutput(toolCall, collectedOutput)

      await this.db
        .update(toolCalls)
        .set({
          state: 'completed',
          output: collectedOutput,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(toolCalls.id, toolCallId))

      if (toolCall.blockId) {
        await this.replaceToolResultBlock(
          toolCall.blockId,
          collectedOutput,
          toolCall
        )
      }

      this.logger.info('Tool call completed successfully', {
        toolCallId,
        outputLength: collectedOutput.length,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      await this.db
        .update(toolCalls)
        .set({
          state: 'error',
          error: message,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(toolCalls.id, toolCallId))

      if (toolCall.blockId) {
        await this.replaceToolResultBlock(
          toolCall.blockId,
          `Error: ${message}`,
          toolCall
        )
      }

      this.logger.error('Tool call failed', {
        toolCallId,
        error: message,
      })

      await handlers?.onError?.(message)

      throw error
    }
  }

  private async failToolCall(toolCall: ToolCall, message: string) {
    await this.db
      .update(toolCalls)
      .set({
        state: 'error',
        error: message,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(toolCalls.id, toolCall.id))

    if (toolCall.blockId) {
      await this.replaceToolResultBlock(
        toolCall.blockId,
        `Error: ${message}`,
        toolCall
      )
    }

    this.logger.error('Tool call failed', {
      toolCallId: toolCall.id,
      error: message,
    })
  }

  private async appendToolOutput(toolCall: ToolCall, chunk: string) {
    if (!chunk) return

    const [current] = await this.db
      .select({ output: toolCalls.output })
      .from(toolCalls)
      .where(eq(toolCalls.id, toolCall.id))

    const sanitized = sanitizeShellOutput(chunk)

    await this.db
      .update(toolCalls)
      .set({
        output: `${current?.output ?? ''}${sanitized}`,
        updatedAt: new Date(),
      })
      .where(eq(toolCalls.id, toolCall.id))
  }

  private async setToolOutput(toolCall: ToolCall, output: string) {
    const sanitized = sanitizeShellOutput(output)
    await this.db
      .update(toolCalls)
      .set({
        output: sanitized,
        updatedAt: new Date(),
      })
      .where(eq(toolCalls.id, toolCall.id))
  }

  private async updateToolCallState(
    toolCallId: number,
    state: ToolState
  ): Promise<void> {
    await this.db
      .update(toolCalls)
      .set({
        state,
        updatedAt: new Date(),
        ...(state === 'executing' && { startedAt: new Date() }),
      })
      .where(eq(toolCalls.id, toolCallId))
  }

  private async getPromptForToolCall(toolCall: ToolCall) {
    const [prompt] = await this.db
      .select()
      .from(prompts)
      .where(eq(prompts.id, toolCall.promptId))

    if (!prompt) {
      throw new Error(`Prompt ${toolCall.promptId} not found`)
    }

    return prompt
  }

  private async updateToolResultBlock(
    blockId: number,
    delta: string,
    append: boolean,
    toolCall: ToolCall
  ) {
    if (!delta) return

    const sanitized = sanitizeShellOutput(delta)

    const [current] = await this.db
      .select({ content: blocks.content, metadata: blocks.metadata })
      .from(blocks)
      .where(eq(blocks.id, blockId))

    const existingContent = append ? current?.content ?? '' : ''
    const combined = `${existingContent}${sanitized}`
    const metadata = {
      ...(current?.metadata ?? {}),
      toolUseId: toolCall.apiToolCallId,
      toolName: toolCall.name,
      input: toolCall.input,
    }

    await this.db
      .update(blocks)
      .set({
        type: 'tool_result',
        content: combined,
        metadata,
        updatedAt: new Date(),
      })
      .where(eq(blocks.id, blockId))
  }

  private async replaceToolResultBlock(
    blockId: number,
    result: string,
    toolCall: ToolCall
  ) {
    const sanitized = sanitizeShellOutput(result)

    const [current] = await this.db
      .select({ metadata: blocks.metadata })
      .from(blocks)
      .where(eq(blocks.id, blockId))

    const metadata = {
      ...(current?.metadata ?? {}),
      toolUseId: toolCall.apiToolCallId,
      toolName: toolCall.name,
      input: toolCall.input,
    }

    await this.db
      .update(blocks)
      .set({
        type: 'tool_result',
        content: sanitized,
        metadata,
        updatedAt: new Date(),
      })
      .where(eq(blocks.id, blockId))
  }

  async getToolCallStatus(toolCallId: number): Promise<ToolCall | null> {
    const [toolCall] = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.id, toolCallId))

    return toolCall || null
  }

  async cancelToolCall(toolCallId: number): Promise<boolean> {
    const [toolCall] = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.id, toolCallId))

    if (!toolCall || toolCall.state !== 'executing') {
      return false
    }

    this.logger.warn('Tool call cancellation requested but not implemented', {
      toolCallId,
    })

    return false
  }

  async cancelExecution(toolCallId: number): Promise<void> {
    await this.cancelToolCall(toolCallId)
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up tool executor service')
  }

  async getStats() {
    const recentCalls = await this.db
      .select({
        id: toolCalls.id,
        name: toolCalls.name,
        state: toolCalls.state,
        createdAt: toolCalls.createdAt,
        completedAt: toolCalls.completedAt,
      })
      .from(toolCalls)
      .orderBy(toolCalls.createdAt)
      .limit(100)

    const stats = {
      totalCalls: recentCalls.length,
      byState: {} as Record<string, number>,
      byTool: {} as Record<string, number>,
    }

    for (const call of recentCalls) {
      stats.byState[call.state] = (stats.byState[call.state] || 0) + 1
      stats.byTool[call.name] = (stats.byTool[call.name] || 0) + 1
    }

    return stats
  }
}
