import { db as defaultDb } from "../db";
import {
  prompts,
  messages,
  blocks,
  events,
  toolCalls,
  type NewEvent,
  type NewBlock,
  type NewToolCall,
} from "../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import type { StreamEvent } from "./types";
import { Logger } from "../utils/logger";
import type { ToolExecutorService } from "../services/toolExecutorService";

export class StreamingStateMachine {
  private promptId: number;
  private eventIndex: number = 0;
  private db: any;
  private logger: Logger;
  private toolExecutor?: ToolExecutorService;

  constructor(
    promptId: number,
    dbInstance: any = defaultDb,
    toolExecutor?: ToolExecutorService,
  ) {
    this.promptId = promptId;
    this.db = dbInstance;
    this.toolExecutor = toolExecutor;
    this.logger = new Logger({ promptId });
    this.logger.info("StreamingStateMachine initialized", {
      hasToolExecutor: !!toolExecutor,
    });
  }

  /**
   * Process a stream event and update database state
   */
  async processStreamEvent(event: StreamEvent): Promise<void> {
    const eventLogger = this.logger.child({
      eventIndex: this.eventIndex,
      eventType: event.type,
      blockType: event.blockType,
      blockIndex: event.blockIndex,
    });

    eventLogger.info(`Processing stream event: ${event.type}`, {
      deltaLength: event.delta?.length,
      hasMetadata: !!event.metadata,
      hasToolCallData: !!event.toolCallData,
    });

    try {
      await this.db.transaction(async (tx: any) => {
        // 1. Store raw event
        const eventRecord = {
          promptId: this.promptId,
          indexNum: this.eventIndex,
          type: event.type,
          blockType: event.blockType,
          blockIndex: event.blockIndex,
          delta: event.delta,
        } as NewEvent;

        eventLogger.dbOperation("insert", "events", {
          eventIndex: this.eventIndex,
          record: eventRecord,
          table: "events",
        });

        eventLogger.info("Storing raw event in database", {
          table: "events",
          promptId: this.promptId,
          eventIndex: this.eventIndex,
          eventType: event.type,
          blockType: event.blockType,
          blockIndex: event.blockIndex,
          deltaLength: event.delta?.length || 0,
          deltaContent:
            event.delta?.substring(0, 200) +
            (event.delta && event.delta.length > 200 ? "..." : ""),
          hasMetadata: !!event.metadata,
        });

        await tx.insert(events).values(eventRecord);
        this.eventIndex++;

        // 2. Process based on event type
        switch (event.type) {
          case "block_start":
            await this.handleBlockStart(tx, event);
            break;
          case "block_delta":
            await this.handleBlockDelta(tx, event);
            break;
          case "block_end":
            await this.handleBlockEnd(tx, event);
            break;
        }
      });

      eventLogger.info(`Successfully processed stream event: ${event.type}`);
    } catch (error) {
      eventLogger.error(`Failed to process stream event: ${event.type}`, error);
      throw error;
    }
  }

  private async handleBlockStart(tx: any, event: StreamEvent) {
    if (!event.blockType || event.blockIndex === undefined) {
      throw new Error("Block start requires blockType and blockIndex");
    }

    const blockLogger = this.logger.child({
      blockType: event.blockType,
      blockIndex: event.blockIndex,
    });

    blockLogger.info(`Starting new block: ${event.blockType}`);

    // Create new block
    const blockRecord = {
      promptId: this.promptId,
      type: event.blockType,
      indexNum: event.blockIndex,
      content: "",
      metadata: event.metadata,
    } as NewBlock;

    blockLogger.info("Creating new block in database", {
      table: "blocks",
      record: blockRecord,
      hasMetadata: !!event.metadata,
      metadataKeys: event.metadata ? Object.keys(event.metadata) : [],
    });

    blockLogger.dbOperation("insert", "blocks", { record: blockRecord });
    await tx.insert(blocks).values(blockRecord);

    // Update prompt's current block
    blockLogger.stateTransition("CREATED", "IN_PROGRESS");
    blockLogger.dbOperation("update", "prompts", {
      currentBlock: event.blockIndex,
    });
    await tx
      .update(prompts)
      .set({
        state: "IN_PROGRESS",
        currentBlock: event.blockIndex,
        lastUpdated: new Date(),
      })
      .where(eq(prompts.id, this.promptId));

    blockLogger.info(`Block started successfully: ${event.blockType}`);
  }

  private async handleBlockDelta(tx: any, event: StreamEvent) {
    if (
      event.blockIndex === undefined ||
      event.delta === undefined ||
      event.delta === null
    ) {
      throw new Error("Block delta requires blockIndex and delta content");
    }

    const deltaLogger = this.logger.child({
      blockIndex: event.blockIndex,
      deltaLength: event.delta.length,
    });

    deltaLogger.debug(`Appending delta to block ${event.blockIndex}`, {
      delta:
        event.delta.substring(0, 50) + (event.delta.length > 50 ? "..." : ""),
    });

    // Append delta to block content
    deltaLogger.dbOperation("select", "blocks");
    const [block] = await tx
      .select()
      .from(blocks)
      .where(
        and(
          eq(blocks.promptId, this.promptId),
          eq(blocks.indexNum, event.blockIndex),
        ),
      );

    if (!block) {
      throw new Error(`Block ${event.blockIndex} not found`);
    }

    const oldContent = block.content || "";
    const newContent = oldContent + event.delta;
    const newContentLength = newContent.length;

    deltaLogger.info("Updating block content in database", {
      table: "blocks",
      blockId: block.id,
      blockIndex: event.blockIndex,
      oldContentLength: oldContent.length,
      newContentLength: newContentLength,
      deltaLength: event.delta.length,
      deltaContent: event.delta,
      newContentPreview:
        newContent.substring(0, 200) + (newContent.length > 200 ? "..." : ""),
    });

    deltaLogger.dbOperation("update", "blocks", {
      blockId: block.id,
      oldLength: oldContent.length,
      newLength: newContentLength,
      operation: "append_delta",
    });

    await tx
      .update(blocks)
      .set({
        content: newContent,
        updatedAt: new Date(),
      })
      .where(eq(blocks.id, block.id));

    deltaLogger.debug(
      `Delta appended successfully, new content length: ${newContentLength}`,
    );
  }

  private async handleBlockEnd(tx: any, event: StreamEvent) {
    const endLogger = this.logger.child({
      blockType: event.blockType,
      blockIndex: event.blockIndex,
    });

    endLogger.info(`Block end: ${event.blockType}`, {
      hasToolCallData: !!event.toolCallData,
    });

    if (event.blockType === "tool_call" && event.toolCallData) {
      endLogger.info("Processing tool call block end");

      // Get the block
      endLogger.dbOperation("select", "blocks", {
        promptId: this.promptId,
        blockIndex: event.blockIndex,
      });

      const [block] = await tx
        .select()
        .from(blocks)
        .where(
          and(
            eq(blocks.promptId, this.promptId),
            eq(blocks.indexNum, event.blockIndex!),
          ),
        );

      if (!block) {
        throw new Error(`Tool call block ${event.blockIndex} not found`);
      }

      const toolCallRecord = {
        promptId: this.promptId,
        blockId: block.id,
        apiToolCallId: event.toolCallData.apiToolCallId,
        toolName: event.toolCallData.toolName,
        state: "created",
        request: event.toolCallData.request,
      } as NewToolCall;

      endLogger.info("Creating tool call record in database", {
        table: "tool_calls",
        blockId: block.id,
        toolName: event.toolCallData.toolName,
        apiToolCallId: event.toolCallData.apiToolCallId,
        request: event.toolCallData.request,
        record: toolCallRecord,
      });

      // Create tool call record
      endLogger.dbOperation("insert", "tool_calls", { record: toolCallRecord });
      await tx.insert(toolCalls).values(toolCallRecord);
    } else {
      endLogger.info("Block end completed (no tool call data)");
    }
  }

  /**
   * Handle message stop event
   */
  async handleMessageStop(): Promise<void> {
    this.logger.info("Handling message stop event");

    // Check if there are pending tool calls
    this.logger.dbOperation("select", "tool_calls", {
      state: ["created", "running"],
    });
    const pendingTools = await this.db
      .select()
      .from(toolCalls)
      .where(
        and(
          eq(toolCalls.promptId, this.promptId),
          inArray(toolCalls.state, ["created", "running"]),
        ),
      );

    if (pendingTools.length > 0) {
      // Transition to WAITING_FOR_TOOLS
      this.logger.stateTransition("IN_PROGRESS", "WAITING_FOR_TOOLS", {
        pendingToolsCount: pendingTools.length,
        toolNames: pendingTools.map((t: any) => t.toolName),
      });

      this.logger.dbOperation("update", "prompts", {
        state: "WAITING_FOR_TOOLS",
      });
      await this.db
        .update(prompts)
        .set({
          state: "WAITING_FOR_TOOLS",
          lastUpdated: new Date(),
        })
        .where(eq(prompts.id, this.promptId));

      this.logger.info(
        `Message stopped, waiting for ${pendingTools.length} pending tools`,
      );

      // Execute tool calls if we have a tool executor
      if (this.toolExecutor) {
        this.logger.info("Starting tool execution", {
          pendingToolsCount: pendingTools.length,
        });

        // Execute all pending tool calls asynchronously
        const execPromises = pendingTools.map(async (tool: any) => {
          try {
            await this.toolExecutor!.executeToolCall(tool.id);
            this.logger.info(`Tool call ${tool.id} completed successfully`, {
              toolName: tool.toolName,
            });
          } catch (error) {
            this.logger.error(`Tool call ${tool.id} failed`, {
              toolName: tool.toolName,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        // Don't wait for completion here - tools run in background
        // The StreamingServer will check for completion periodically
        Promise.allSettled(execPromises).then(() => {
          this.logger.info("All tool executions completed or failed");
        });
      } else {
        this.logger.warn(
          "No tool executor available - tools will remain pending",
        );
      }
    } else {
      // Complete the prompt
      this.logger.info("Message stopped, no pending tools - completing prompt");
      await this.completePrompt();
    }
  }

  /**
   * Complete the prompt and finalize blocks
   */
  async completePrompt(): Promise<void> {
    this.logger.info("Completing prompt");

    try {
      await this.db.transaction(async (tx: any) => {
        // Get prompt details
        this.logger.dbOperation("select", "prompts");
        const [prompt] = await tx
          .select()
          .from(prompts)
          .where(eq(prompts.id, this.promptId));

        if (!prompt || !prompt.messageId) {
          throw new Error("Prompt or message not found");
        }

        const completionLogger = this.logger.child({
          messageId: prompt.messageId,
        });

        // 1. Finalize blocks - link to message
        completionLogger.dbOperation("update", "blocks", {
          action: "finalize_and_link_to_message",
        });
        await tx
          .update(blocks)
          .set({
            messageId: prompt.messageId,
            isFinalized: true,
            updatedAt: new Date(),
          })
          .where(eq(blocks.promptId, this.promptId));

        // 2. Mark message as complete
        completionLogger.dbOperation("update", "messages", {
          isComplete: true,
        });
        await tx
          .update(messages)
          .set({
            isComplete: true,
            updatedAt: new Date(),
          })
          .where(eq(messages.id, prompt.messageId));

        // 3. Update prompt state
        completionLogger.stateTransition("IN_PROGRESS", "COMPLETED");
        completionLogger.dbOperation("update", "prompts", {
          state: "COMPLETED",
        });
        await tx
          .update(prompts)
          .set({
            state: "COMPLETED",
            lastUpdated: new Date(),
          })
          .where(eq(prompts.id, this.promptId));
      });

      this.logger.info("Prompt completed successfully");
    } catch (error) {
      this.logger.error("Failed to complete prompt", error);
      throw error;
    }
  }

  /**
   * Handle stream error
   */
  async handleError(error: string): Promise<void> {
    this.logger.error("Handling stream error", { errorMessage: error });
    this.logger.stateTransition("*", "ERROR", { errorMessage: error });

    try {
      this.logger.dbOperation("update", "prompts", { state: "ERROR", error });
      await this.db
        .update(prompts)
        .set({
          state: "ERROR",
          error: error,
          lastUpdated: new Date(),
        })
        .where(eq(prompts.id, this.promptId));

      this.logger.info("Stream error handled, prompt marked as ERROR");
    } catch (dbError) {
      this.logger.error("Failed to handle stream error", dbError);
      throw dbError;
    }
  }

  /**
   * Check if all tool calls are complete and ready to continue
   */
  async checkToolCompletion(): Promise<{
    allComplete: boolean;
    completedTools: any[];
    pendingTools: any[];
  }> {
    this.logger.info("Checking tool completion status");

    const allTools = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.promptId, this.promptId));

    const pendingTools = allTools.filter(
      (t: any) => t.state === "created" || t.state === "running",
    );

    const completedTools = allTools.filter(
      (t: any) =>
        t.state === "complete" || t.state === "error" || t.state === "canceled",
    );

    const allComplete = pendingTools.length === 0;

    this.logger.info("Tool completion check result", {
      totalTools: allTools.length,
      pendingTools: pendingTools.length,
      completedTools: completedTools.length,
      allComplete,
      pendingToolNames: pendingTools.map((t: any) => t.toolName),
      completedToolNames: completedTools.map((t: any) => t.toolName),
    });

    return {
      allComplete,
      completedTools,
      pendingTools,
    };
  }

  /**
   * Continue execution after tool completion
   */
  async continueAfterTools(): Promise<{ status: string; toolResults: any[] }> {
    this.logger.info("Continuing after tool completion");

    const { allComplete, completedTools } = await this.checkToolCompletion();

    if (!allComplete) {
      return { status: "still_waiting", toolResults: [] };
    }

    // Transition back to IN_PROGRESS so streaming can continue
    this.logger.stateTransition("WAITING_FOR_TOOLS", "IN_PROGRESS", {
      completedToolsCount: completedTools.length,
    });

    this.logger.dbOperation("update", "prompts", {
      state: "IN_PROGRESS",
    });
    await this.db
      .update(prompts)
      .set({
        state: "IN_PROGRESS",
        lastUpdated: new Date(),
      })
      .where(eq(prompts.id, this.promptId));

    // Prepare tool results for the AI
    const toolResults = completedTools.map((tool: any) => ({
      apiToolCallId: tool.apiToolCallId,
      toolName: tool.toolName,
      state: tool.state,
      response: tool.response,
      error: tool.error,
    }));

    this.logger.info("Ready to continue with tool results", {
      toolResultsCount: toolResults.length,
      successfulResults: toolResults.filter((r) => r.state === "complete")
        .length,
      errorResults: toolResults.filter((r) => r.state === "error").length,
      canceledResults: toolResults.filter((r) => r.state === "canceled").length,
    });

    return { status: "ready", toolResults };
  }

  /**
   * Cancel the stream
   */
  async cancel(): Promise<void> {
    this.logger.info("Canceling stream and tool executions");

    await this.db.transaction(async (tx: any) => {
      // Get all running tool calls to cancel
      const runningTools = await tx
        .select()
        .from(toolCalls)
        .where(
          and(
            eq(toolCalls.promptId, this.promptId),
            inArray(toolCalls.state, ["created", "running"]),
          ),
        );

      // Cancel tool executions via tool executor
      if (this.toolExecutor && runningTools.length > 0) {
        this.logger.info("Canceling tool executions", {
          toolCount: runningTools.length,
        });

        // Cancel each tool execution
        const cancelPromises = runningTools.map(async (tool: any) => {
          try {
            await this.toolExecutor!.cancelExecution(tool.id);
            this.logger.info(`Canceled tool execution ${tool.id}`, {
              toolName: tool.toolName,
            });
          } catch (error) {
            this.logger.error(`Failed to cancel tool execution ${tool.id}`, {
              toolName: tool.toolName,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        await Promise.allSettled(cancelPromises);
      }

      // Update database state for any remaining tool calls
      await tx
        .update(toolCalls)
        .set({
          state: "canceled",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(toolCalls.promptId, this.promptId),
            inArray(toolCalls.state, ["created", "running"]),
          ),
        );

      // Update prompt state
      this.logger.stateTransition("*", "CANCELED");
      await tx
        .update(prompts)
        .set({
          state: "CANCELED",
          lastUpdated: new Date(),
        })
        .where(eq(prompts.id, this.promptId));
    });

    this.logger.info("Stream cancellation completed");
  }

  /**
   * Resume from error state
   */
  async resume(): Promise<{ status: string; data?: any }> {
    const [prompt] = await this.db
      .select()
      .from(prompts)
      .where(eq(prompts.id, this.promptId));

    if (!prompt) {
      return { status: "not_found" };
    }

    switch (prompt.state) {
      case "COMPLETED":
        return { status: "already_complete" };

      case "FAILED":
      case "CREATED":
        // Retry from beginning
        await this.db
          .update(prompts)
          .set({ state: "IN_PROGRESS", lastUpdated: new Date() })
          .where(eq(prompts.id, this.promptId));
        return { status: "retry_from_start" };

      case "ERROR":
        // Get partial content for resume
        const partialBlocks = await this.db
          .select()
          .from(blocks)
          .where(eq(blocks.promptId, this.promptId));
        return { status: "resume_with_partial", data: partialBlocks };

      case "WAITING_FOR_TOOLS":
        // Use the new tool completion checking method
        const { allComplete, completedTools, pendingTools } =
          await this.checkToolCompletion();

        if (allComplete) {
          // Ready to send results back to AI
          const continueResult = await this.continueAfterTools();
          return {
            status: "continue_with_tools",
            data: continueResult.toolResults,
          };
        } else {
          return {
            status: "waiting_for_tools",
            data: {
              completedTools,
              pendingTools,
              totalTools: completedTools.length + pendingTools.length,
            },
          };
        }

      case "CANCELED":
        return { status: "canceled" };

      default:
        return { status: "unknown_state" };
    }
  }
}
