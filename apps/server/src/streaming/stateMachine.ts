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

export class StreamingStateMachine {
  private promptId: number;
  private eventIndex: number = 0;
  private db: any;

  constructor(promptId: number, dbInstance: any = defaultDb) {
    this.promptId = promptId;
    this.db = dbInstance;
  }

  /**
   * Process a stream event and update database state
   */
  async processStreamEvent(event: StreamEvent): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      // 1. Store raw event
      await tx.insert(events).values({
        promptId: this.promptId,
        indexNum: this.eventIndex++,
        type: event.type,
        blockType: event.blockType,
        blockIndex: event.blockIndex,
        delta: event.delta,
      } as NewEvent);

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
  }

  private async handleBlockStart(tx: any, event: StreamEvent) {
    if (!event.blockType || event.blockIndex === undefined) {
      throw new Error("Block start requires blockType and blockIndex");
    }

    // Create new block
    await tx.insert(blocks).values({
      promptId: this.promptId,
      type: event.blockType,
      indexNum: event.blockIndex,
      content: "",
      metadata: event.metadata,
    } as NewBlock);

    // Update prompt's current block
    await tx
      .update(prompts)
      .set({ currentBlock: event.blockIndex, lastUpdated: new Date() })
      .where(eq(prompts.id, this.promptId));
  }

  private async handleBlockDelta(tx: any, event: StreamEvent) {
    if (event.blockIndex === undefined || !event.delta) {
      throw new Error("Block delta requires blockIndex and delta content");
    }

    // Append delta to block content
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

    await tx
      .update(blocks)
      .set({
        content: (block.content || "") + event.delta,
        updatedAt: new Date(),
      })
      .where(eq(blocks.id, block.id));
  }

  private async handleBlockEnd(tx: any, event: StreamEvent) {
    if (event.blockType === "tool_call" && event.toolCallData) {
      // Get the block
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

      // Create tool call record
      await tx.insert(toolCalls).values({
        promptId: this.promptId,
        blockId: block.id,
        apiToolCallId: event.toolCallData.apiToolCallId,
        toolName: event.toolCallData.toolName,
        state: "created",
        request: event.toolCallData.request,
      } as NewToolCall);
    }
  }

  /**
   * Handle message stop event
   */
  async handleMessageStop(): Promise<void> {
    // Check if there are pending tool calls
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
      await this.db
        .update(prompts)
        .set({
          state: "WAITING_FOR_TOOLS",
          lastUpdated: new Date(),
        })
        .where(eq(prompts.id, this.promptId));
    } else {
      // Complete the prompt
      await this.completePrompt();
    }
  }

  /**
   * Complete the prompt and finalize blocks
   */
  async completePrompt(): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      // Get prompt details
      const [prompt] = await tx
        .select()
        .from(prompts)
        .where(eq(prompts.id, this.promptId));

      if (!prompt || !prompt.messageId) {
        throw new Error("Prompt or message not found");
      }

      // 1. Finalize blocks - link to message
      await tx
        .update(blocks)
        .set({
          messageId: prompt.messageId,
          isFinalized: true,
          updatedAt: new Date(),
        })
        .where(eq(blocks.promptId, this.promptId));

      // 2. Mark message as complete
      await tx
        .update(messages)
        .set({
          isComplete: true,
          updatedAt: new Date(),
        })
        .where(eq(messages.id, prompt.messageId));

      // 3. Update prompt state
      await tx
        .update(prompts)
        .set({
          state: "COMPLETED",
          lastUpdated: new Date(),
        })
        .where(eq(prompts.id, this.promptId));
    });
  }

  /**
   * Handle stream error
   */
  async handleError(error: string): Promise<void> {
    await this.db
      .update(prompts)
      .set({
        state: "ERROR",
        error: error,
        lastUpdated: new Date(),
      })
      .where(eq(prompts.id, this.promptId));
  }

  /**
   * Cancel the stream
   */
  async cancel(): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      // Cancel any running tool calls
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
      await tx
        .update(prompts)
        .set({
          state: "CANCELED",
          lastUpdated: new Date(),
        })
        .where(eq(prompts.id, this.promptId));
    });
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
        // Check tool status
        const tools = await this.db
          .select()
          .from(toolCalls)
          .where(eq(toolCalls.promptId, this.promptId));

        const allComplete = tools.every(
          (t: any) =>
            t.state === "complete" ||
            t.state === "error" ||
            t.state === "canceled",
        );

        if (allComplete) {
          // Ready to send results back to AI
          await this.db
            .update(prompts)
            .set({ state: "IN_PROGRESS", lastUpdated: new Date() })
            .where(eq(prompts.id, this.promptId));
          return { status: "continue_with_tools", data: tools };
        } else {
          return { status: "waiting_for_tools", data: tools };
        }

      case "CANCELED":
        return { status: "canceled" };

      default:
        return { status: "unknown_state" };
    }
  }
}
