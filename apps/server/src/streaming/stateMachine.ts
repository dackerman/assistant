import { eq } from "drizzle-orm";
import { db as defaultDb } from "../db";
import type { DB } from "../db";
import { blocks, prompts, toolCalls } from "../db/schema";
import type { ToolExecutorService } from "../services/toolExecutorService";
import type { Logger } from "../utils/logger";
import type { BlockType } from "../db/schema";

// Minimal logger interface for stubbing
interface MinimalLogger {
  info: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, error?: Error | unknown) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  debug: (message: string, data?: Record<string, unknown>) => void;
}

/**
 * Simplified StreamingStateMachine stub for compatibility.
 * This is a temporary implementation during the refactoring process.
 * Most functionality is stubbed out or simplified.
 */
export class StreamingStateMachine {
  private promptId: number;
  private db: DB;
  private logger: Logger;
  private toolExecutor?: ToolExecutorService;

  constructor(
    promptId: number,
    dbInstance: DB = defaultDb,
    toolExecutor?: ToolExecutorService,
    logger?: Logger,
  ) {
    this.promptId = promptId;
    this.db = dbInstance;
    this.toolExecutor = toolExecutor;
    this.logger =
      logger ||
      ({
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
      } as unknown as Logger);
  }

  /**
   * Get blocks for the prompt (stubbed)
   */
  async getBlocks() {
    const promptBlocks = await this.db
      .select()
      .from(blocks)
      .innerJoin(prompts, eq(blocks.messageId, prompts.messageId))
      .where(eq(prompts.id, this.promptId))
      .orderBy(blocks.order);

    return promptBlocks.map((row) => row.blocks);
  }

  /**
   * Check tool completion (stubbed)
   */
  async checkToolCompletion() {
    const toolCallsForPrompt = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.promptId, this.promptId));

    const pendingTools = toolCallsForPrompt.filter(
      (call) => call.state === "pending" || call.state === "executing",
    );

    return {
      allComplete: pendingTools.length === 0,
      completedTools: toolCallsForPrompt.filter(
        (call) => call.state === "completed",
      ),
      failedTools: toolCallsForPrompt.filter((call) => call.state === "error"),
      pendingTools,
    };
  }

  /**
   * Continue after tools (stubbed)
   */
  async continueAfterTools() {
    return {
      status: "ready" as const,
      message: "Tools completed",
    };
  }

  /**
   * Complete prompt (stubbed)
   */
  async completePrompt() {
    await this.db
      .update(prompts)
      .set({
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(prompts.id, this.promptId));

    return {
      status: "completed" as const,
      promptId: this.promptId,
    };
  }

  /**
   * Create block (stubbed)
   */
  async createBlock(type: BlockType, content: string, metadata?: Record<string, unknown>) {
    // Get the message ID for this prompt
    const [prompt] = await this.db
      .select({ messageId: prompts.messageId })
      .from(prompts)
      .where(eq(prompts.id, this.promptId));

    if (!prompt) {
      throw new Error(`Prompt ${this.promptId} not found`);
    }

    // Get next order
    const existingBlocks = await this.db
      .select({ order: blocks.order })
      .from(blocks)
      .where(eq(blocks.messageId, prompt.messageId))
      .orderBy(blocks.order);

    const nextOrder =
      existingBlocks.length > 0
        ? Math.max(...existingBlocks.map((b) => b.order)) + 1
        : 0;

    const [block] = await this.db
      .insert(blocks)
      .values({
        messageId: prompt.messageId,
        type,
        content,
        order: nextOrder,
        metadata,
      })
      .returning();

    return block;
  }

  /**
   * Update block (stubbed)
   */
  async updateBlock(blockId: number, content: string, metadata?: Record<string, unknown>) {
    await this.db
      .update(blocks)
      .set({
        content,
        metadata,
        updatedAt: new Date(),
      })
      .where(eq(blocks.id, blockId));
  }

  /**
   * Cancel tools (stubbed)
   */
  async cancelTools() {
    if (this.toolExecutor) {
      const toolCallsForPrompt = await this.db
        .select()
        .from(toolCalls)
        .where(eq(toolCalls.promptId, this.promptId));

      for (const call of toolCallsForPrompt) {
        if (call.state === "executing") {
          await this.toolExecutor.cancelExecution(call.id);
        }
      }
    }

    return {
      status: "cancelled" as const,
      message: "Tools cancelled",
    };
  }

  /**
   * Stream events (stubbed - does nothing)
   */
  async *streamEvents() {
    // Stub - yields nothing
    return;
  }

  /**
   * Process stream event (stubbed)
   */
  async processStreamEvent(event: { type: string; [key: string]: unknown }) {
    // Stub implementation - just log the event
    this.logger.debug("Processing stream event", { eventType: event.type });
    return;
  }

  /**
   * Resume streaming (stubbed)
   */
  async resume() {
    // Check if there are any pending/executing tool calls
    const completion = await this.checkToolCompletion();

    if (completion.pendingTools.length > 0) {
      return {
        status: "waiting_for_tools" as const,
        data: completion.pendingTools,
      };
    }

    if (completion.completedTools.length > 0) {
      return {
        status: "continue_with_tools" as const,
        data: completion.completedTools,
      };
    }

    return {
      status: "already_complete" as const,
      data: [],
    };
  }

  /**
   * Get block content (stubbed)
   */
  async getBlockContent(blockIndex: number) {
    // Stub - return empty content
    return "";
  }

  /**
   * Handle message stop (stubbed)
   */
  async handleMessageStop() {
    return {
      waitingForTools: false,
    };
  }

  /**
   * Handle error (stubbed)
   */
  async handleError(errorMessage: string) {
    await this.db
      .update(prompts)
      .set({
        status: "error",
        error: errorMessage,
        completedAt: new Date(),
      })
      .where(eq(prompts.id, this.promptId));

    return {
      status: "error" as const,
      message: errorMessage,
    };
  }

  /**
   * Get conversation ID (stubbed)
   */
  async getConversationId() {
    const [prompt] = await this.db
      .select({ conversationId: prompts.conversationId })
      .from(prompts)
      .where(eq(prompts.id, this.promptId));

    return prompt?.conversationId || 0;
  }
}
