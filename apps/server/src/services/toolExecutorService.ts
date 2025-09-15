import { and, eq } from "drizzle-orm";
import { db as defaultDb } from "../db";
import type { DB } from "../db";
import {
  type ToolCall,
  type ToolState,
  blocks,
  prompts,
  toolCalls,
} from "../db/schema";
import { Logger } from "../utils/logger";
import { SessionManager } from "./sessionManager";

export interface ToolExecutorConfig {
  timeout?: number;
}

/**
 * Simplified ToolExecutorService that uses SessionManager and BashSession
 * for tool execution. Much simpler than the original complex implementation.
 */
export class ToolExecutorService {
  private db: DB;
  private logger: Logger;
  private sessionManager: SessionManager;
  private config: Required<ToolExecutorConfig>;

  constructor(dbInstance: DB = defaultDb, config: ToolExecutorConfig = {}) {
    this.db = dbInstance;
    this.logger = new Logger({ service: "ToolExecutorService" });
    this.sessionManager = new SessionManager({
      timeout: config.timeout || 300000, // 5 minutes
    });
    this.config = {
      timeout: config.timeout || 300000,
    };
  }

  /**
   * Initialize the service (compatibility method)
   */
  async initialize(): Promise<void> {
    this.logger.info("ToolExecutorService initialized");
    // No special initialization needed for simplified version
  }

  /**
   * Execute a tool call by ID
   */
  async executeToolCall(toolCallId: number): Promise<void> {
    // Get the tool call
    const [toolCall] = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.id, toolCallId));

    if (!toolCall) {
      throw new Error(`Tool call ${toolCallId} not found`);
    }

    if (toolCall.state !== "pending") {
      this.logger.info("Tool call not in pending state", {
        toolCallId,
        currentState: toolCall.state,
      });
      return;
    }

    this.logger.info("Executing tool call", {
      toolCallId,
      toolName: toolCall.name,
    });

    try {
      // Mark as executing
      await this.updateToolCallState(toolCallId, "executing");

      // Get conversation ID from prompt
      const conversationId = await this.getConversationIdForToolCall(toolCall);

      // Execute the tool
      let result: string;
      if (toolCall.name === "bash") {
        result = await this.executeBashTool(toolCall, conversationId);
      } else {
        throw new Error(`Unsupported tool: ${toolCall.name}`);
      }

      // Update tool call with results
      await this.db
        .update(toolCalls)
        .set({
          state: "completed",
          output: result,
          completedAt: new Date(),
        })
        .where(eq(toolCalls.id, toolCallId));

      // Create or update tool result block
      if (toolCall.blockId) {
        await this.updateToolResultBlock(toolCall.blockId, result);
      }

      this.logger.info("Tool call completed successfully", {
        toolCallId,
        outputLength: result.length,
      });
    } catch (error) {
      // Mark as failed
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await this.db
        .update(toolCalls)
        .set({
          state: "error",
          error: errorMessage,
          completedAt: new Date(),
        })
        .where(eq(toolCalls.id, toolCallId));

      // Update tool result block with error
      if (toolCall.blockId) {
        await this.updateToolResultBlock(
          toolCall.blockId,
          `Error: ${errorMessage}`,
        );
      }

      this.logger.error("Tool call failed", {
        toolCallId,
        error: errorMessage,
      });

      throw error;
    }
  }

  /**
   * Execute a bash tool using the session manager
   */
  private async executeBashTool(
    toolCall: ToolCall,
    conversationId: number,
  ): Promise<string> {
    // Extract command from input
    const input = toolCall.input as any;
    const command = input?.command;

    if (!command || typeof command !== "string") {
      throw new Error("Invalid bash command input");
    }

    this.logger.info("Executing bash command", {
      toolCallId: toolCall.id,
      command: command.substring(0, 100), // Log first 100 chars
    });

    // Get or create bash session for this conversation
    const session = await this.sessionManager.getSession(conversationId);

    // Execute command with streaming support
    const result = await session.exec(command, {
      onStdout: (chunk) => {
        // Could broadcast streaming updates here if needed
        this.logger.debug("Command output chunk", {
          toolCallId: toolCall.id,
          chunkLength: chunk.length,
        });
      },
      onStderr: (chunk) => {
        this.logger.debug("Command error chunk", {
          toolCallId: toolCall.id,
          chunkLength: chunk.length,
        });
      },
      onError: (error) => {
        this.logger.error("Command execution error", {
          toolCallId: toolCall.id,
          error,
        });
      },
    });

    if (!result.success) {
      throw new Error(
        result.error || `Command failed with exit code ${result.exitCode}`,
      );
    }

    return result.stdout;
  }

  /**
   * Update tool call state
   */
  private async updateToolCallState(
    toolCallId: number,
    state: ToolState,
  ): Promise<void> {
    await this.db
      .update(toolCalls)
      .set({
        state,
        updatedAt: new Date(),
        ...(state === "executing" && { startedAt: new Date() }),
      })
      .where(eq(toolCalls.id, toolCallId));
  }

  /**
   * Get conversation ID for a tool call
   */
  private async getConversationIdForToolCall(
    toolCall: ToolCall,
  ): Promise<number> {
    const [prompt] = await this.db
      .select({ conversationId: prompts.conversationId })
      .from(prompts)
      .where(eq(prompts.id, toolCall.promptId));

    if (!prompt) {
      throw new Error(`Prompt ${toolCall.promptId} not found`);
    }

    return prompt.conversationId;
  }

  /**
   * Update or create a tool result block
   */
  private async updateToolResultBlock(
    blockId: number,
    result: string,
  ): Promise<void> {
    // Update existing block or create a result block
    await this.db
      .update(blocks)
      .set({
        type: "tool_result",
        content: result,
        updatedAt: new Date(),
      })
      .where(eq(blocks.id, blockId));
  }

  /**
   * Get status of a tool call
   */
  async getToolCallStatus(toolCallId: number): Promise<ToolCall | null> {
    const [toolCall] = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.id, toolCallId));

    return toolCall || null;
  }

  /**
   * Cancel a tool call (if it's still executing)
   */
  async cancelToolCall(toolCallId: number): Promise<boolean> {
    const [toolCall] = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.id, toolCallId));

    if (!toolCall || toolCall.state !== "executing") {
      return false;
    }

    // For now, we can't really cancel mid-execution with our current setup
    // The bash session would need more sophisticated cancellation support
    this.logger.warn("Tool call cancellation requested but not implemented", {
      toolCallId,
    });

    return false;
  }

  /**
   * Alias for cancelToolCall (compatibility)
   */
  async cancelExecution(toolCallId: number): Promise<void> {
    await this.cancelToolCall(toolCallId);
  }

  /**
   * Cleanup - destroy all sessions
   */
  async cleanup(): Promise<void> {
    this.logger.info("Cleaning up tool executor service");
    await this.sessionManager.destroyAllSessions();
  }

  /**
   * Get statistics about tool execution
   */
  async getStats() {
    // Get recent tool call statistics
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
      .limit(100);

    const stats = {
      totalCalls: recentCalls.length,
      byState: {} as Record<string, number>,
      byTool: {} as Record<string, number>,
      sessionStats: this.sessionManager.getStats(),
    };

    // Count by state and tool
    for (const call of recentCalls) {
      stats.byState[call.state] = (stats.byState[call.state] || 0) + 1;
      stats.byTool[call.name] = (stats.byTool[call.name] || 0) + 1;
    }

    return stats;
  }
}
