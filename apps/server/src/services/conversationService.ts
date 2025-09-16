import { and, asc, desc, eq } from "drizzle-orm";
import { db as defaultDb } from "../db";
import type { DB } from "../db";
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
} from "../db/schema";
import { Logger } from "../utils/logger";
import { PromptService, type StreamingCallbacks } from "./promptService";

export class ConversationService {
  private db: DB;
  private logger: Logger;
  private promptService: PromptService;

  constructor(dbInstance: DB = defaultDb) {
    this.db = dbInstance;
    this.logger = new Logger({ service: "ConversationService" });
    this.promptService = new PromptService(dbInstance);
  }

  /**
   * Create a new conversation
   */
  async createConversation(userId: number, title?: string): Promise<number> {
    const [conversation] = await this.db
      .insert(conversations)
      .values({
        userId,
        title: title || "New Conversation",
      } as NewConversation)
      .returning();

    this.logger.info("Created new conversation", {
      conversationId: conversation?.id,
      userId,
      title,
    });

    if (!conversation) {
      throw new Error("Failed to create conversation");
    }
    return conversation.id;
  }

  /**
   * Get conversation with all messages and blocks (includes queued messages)
   */
  async getConversation(conversationId: number, userId: number) {
    // Get conversation
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId),
        ),
      );

    if (!conversation) {
      return null;
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
      .orderBy(messages.createdAt, messages.queueOrder, blocks.order);

    // Group blocks by message
    const messageMap = new Map();
    for (const row of messagesWithBlocks) {
      if (!messageMap.has(row.message.id)) {
        messageMap.set(row.message.id, {
          ...row.message,
          blocks: [],
        });
      }
      if (row.block) {
        messageMap.get(row.message.id)?.blocks.push(row.block);
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
      .orderBy(toolCalls.id);

    // Attach tool calls to blocks
    const toolCallsByBlockId = new Map();
    for (const row of conversationToolCalls) {
      if (row.blockId) {
        toolCallsByBlockId.set(row.blockId, row.toolCall);
      }
    }

    for (const message of messageMap.values()) {
      for (const block of message.blocks) {
        if (toolCallsByBlockId.has(block.id)) {
          block.toolCall = toolCallsByBlockId.get(block.id);
        }
      }
    }

    return {
      conversation,
      messages: Array.from(messageMap.values()),
    };
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
          eq(prompts.status, "streaming"),
        ),
      )
      .orderBy(desc(prompts.createdAt))
      .limit(1);

    return activePrompt || null;
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
          eq(messages.status, "queued"),
        ),
      )
      .orderBy(desc(messages.queueOrder))
      .limit(1);

    const nextQueueOrder = (lastQueued?.queueOrder || 0) + 1;

    const [message] = await this.db
      .insert(messages)
      .values({
        conversationId,
        role: "user",
        content,
        status: "queued",
        queueOrder: nextQueueOrder,
      } as NewMessage)
      .returning();

    this.logger.info("Queued user message", {
      conversationId,
      messageId: message?.id,
      queueOrder: nextQueueOrder,
      contentLength: content.length,
    });

    // If no active prompt, start processing the queue
    const activePrompt = await this.getActivePrompt(conversationId);
    if (!activePrompt) {
      await this.processQueue(conversationId);
    }

    if (!message) {
      throw new Error("Failed to create message");
    }
    return message.id;
  }

  /**
   * Edit a queued message (only allowed if not yet processing)
   */
  async editQueuedMessage(
    messageId: number,
    content: string,
  ): Promise<boolean> {
    const result = await this.db
      .update(messages)
      .set({ content, updatedAt: new Date() })
      .where(and(eq(messages.id, messageId), eq(messages.status, "queued")))
      .returning();

    this.logger.info("Edited queued message", {
      messageId,
      contentLength: content.length,
    });

    return result.length > 0;
  }

  /**
   * Delete a queued message
   */
  async deleteQueuedMessage(messageId: number): Promise<boolean> {
    const result = await this.db
      .delete(messages)
      .where(and(eq(messages.id, messageId), eq(messages.status, "queued")))
      .returning();

    this.logger.info("Deleted queued message", { messageId });
    return result.length > 0;
  }

  /**
   * Process the next queued message
   */
  async processQueue(conversationId: number): Promise<void> {
    // Check if there's already an active prompt
    const activePrompt = await this.getActivePrompt(conversationId);
    if (activePrompt) {
      this.logger.info("Cannot process queue - active prompt exists", {
        conversationId,
        activePromptId: activePrompt.id,
      });
      return;
    }

    // Get the next queued message
    const [nextMessage] = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.status, "queued"),
        ),
      )
      .orderBy(asc(messages.queueOrder))
      .limit(1);

    if (!nextMessage) {
      this.logger.info("No queued messages to process", { conversationId });
      return;
    }

    this.logger.info("Processing next queued message", {
      conversationId,
      messageId: nextMessage.id,
      queueOrder: nextMessage.queueOrder,
    });

    const { assistantMessageId } = await this.db.transaction(async (tx) => {
      // Update message status to processing
      await tx
        .update(messages)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(messages.id, nextMessage.id));

      // Create assistant message for the response
      const [assistantMessage] = await tx
        .insert(messages)
        .values({
          conversationId,
          role: "assistant",
          status: "processing",
        } as NewMessage)
        .returning();

      if (!assistantMessage) {
        throw new Error("Failed to create assistant message");
      }

      // Create a text block for the user message
      await tx.insert(blocks).values({
        messageId: nextMessage.id,
        type: "text",
        content: nextMessage.content,
        order: 0,
      } as NewBlock);

      // Mark user message as completed so it appears in history
      await tx
        .update(messages)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(messages.id, nextMessage.id));

      // Update conversation's updated timestamp
      await tx
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));

      return { assistantMessageId: assistantMessage.id };
    });

    if (!assistantMessageId) {
      this.logger.error("Assistant message missing after queue processing", {
        conversationId,
        messageId: nextMessage.id,
      });
      return;
    }

    try {
      await this.promptService.createAndStreamPrompt(
        {
          conversationId,
          messageId: assistantMessageId,
          model: "claude-sonnet-4-20250514",
          systemMessage: this.getSystemMessage(),
        },
        {
          onPromptCreated: async (promptId) => {
            await this.handlePromptCreated(conversationId, promptId);
          },
          onComplete: async (promptId) => {
            await this.handlePromptComplete(
              conversationId,
              assistantMessageId,
              promptId,
            );
          },
          onError: async (promptId, error) => {
            await this.handlePromptError(
              conversationId,
              nextMessage.id,
              assistantMessageId,
              promptId,
              error,
            );
          },
        },
      );
    } catch (error) {
      this.logger.error("Prompt streaming failed", {
        conversationId,
        userMessageId: nextMessage.id,
        assistantMessageId,
        error,
      });
    }
  }

  /**
   * Mark a message as completed and process next in queue
   */
  async completeMessage(messageId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Get the message to find its conversation
      const [message] = await tx
        .select()
        .from(messages)
        .where(eq(messages.id, messageId));

      if (!message) return;

      // Update message status
      await tx
        .update(messages)
        .set({ status: "completed" })
        .where(eq(messages.id, messageId));

      // Clear active prompt from conversation
      await tx
        .update(conversations)
        .set({ activePromptId: null, updatedAt: new Date() })
        .where(eq(conversations.id, message.conversationId));

      this.logger.info("Completed message", {
        messageId,
        conversationId: message.conversationId,
      });
    });

    // Process next in queue if any
    const [message] = await this.db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId));

    if (message) {
      await this.processQueue(message.conversationId);
    }
  }

  /**
   * Create a block within a message
   */
  async createBlock(
    messageId: number,
    type: string,
    content: string,
    metadata?: unknown,
  ): Promise<number> {
    // Get the current highest order for this message
    const [lastBlock] = await this.db
      .select({ order: blocks.order })
      .from(blocks)
      .where(eq(blocks.messageId, messageId))
      .orderBy(desc(blocks.order))
      .limit(1);

    const nextOrder = (lastBlock?.order || -1) + 1;

    const [block] = await this.db
      .insert(blocks)
      .values({
        messageId,
        type: type as BlockType,
        content,
        order: nextOrder,
        metadata,
      } as NewBlock)
      .returning();

    if (!block) {
      throw new Error("Failed to create block");
    }
    return block.id;
  }

  /**
   * Update a block's content
   */
  async updateBlock(
    blockId: number,
    content: string,
    metadata?: unknown,
  ): Promise<void> {
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
   * List conversations for a user
   */
  async listConversations(userId: number) {
    return await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.updatedAt));
  }

  /**
   * Set conversation title
   */
  async setTitle(conversationId: number, title: string): Promise<void> {
    await this.db
      .update(conversations)
      .set({ title, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }

  /**
   * Delete a conversation and all associated data
   */
  async deleteConversation(
    conversationId: number,
    userId: number,
  ): Promise<void> {
    // Verify the user owns this conversation
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId),
        ),
      );

    if (!conversation) {
      throw new Error("Conversation not found or access denied");
    }

    // Delete the conversation (cascading deletes will handle related data)
    await this.db
      .delete(conversations)
      .where(eq(conversations.id, conversationId));

    this.logger.info("Conversation deleted", {
      conversationId,
      userId,
      title: conversation.title,
    });
  }

  /**
   * Build conversation history for AI model
   */
  async buildConversationHistory(conversationId: number, userId: number) {
    const result = await this.getConversation(conversationId, userId);
    if (!result) return [];

    const history = [];

    // Only include completed messages in the history
    const completedMessages = result.messages.filter(
      (msg: Message) => msg.status === "completed",
    );

    for (const message of completedMessages) {
      if (message.role === "user") {
        // User message - combine all text blocks
        const content = message.blocks
          .filter((b: Block) => b.type === "text")
          .map((b: Block) => b.content)
          .join("");

        if (content) {
          history.push({
            role: "user",
            content,
          });
        }
      } else if (message.role === "assistant") {
        // Assistant message - only include text blocks (not thinking/tool_use)
        const content = message.blocks
          .filter((b: Block) => b.type === "text")
          .map((b: Block) => b.content)
          .join("");

        if (content) {
          history.push({
            role: "assistant",
            content,
          });
        }
      }
    }

    return history;
  }

  /**
   * Get active streaming state for a conversation (compatibility method)
   */
  async getActiveStream(conversationId: number) {
    const activePrompt = await this.getActivePrompt(conversationId);
    if (!activePrompt) {
      return null;
    }

    // Get blocks for the active prompt's message
    const streamingBlocks = await this.db
      .select()
      .from(blocks)
      .where(eq(blocks.messageId, activePrompt.messageId))
      .orderBy(blocks.order);

    return {
      prompt: activePrompt,
      blocks: streamingBlocks,
    };
  }

  async restoreActiveStream(
    conversationId: number,
    callbacks: StreamingCallbacks,
  ) {
    const activePrompt = await this.getActivePrompt(conversationId);
    if (!activePrompt) {
      return null;
    }

    callbacks.onPromptCreated?.(activePrompt.id);

    const streamingBlocks = await this.db
      .select()
      .from(blocks)
      .where(eq(blocks.messageId, activePrompt.messageId))
      .orderBy(blocks.order);

    for (const block of streamingBlocks) {
      callbacks.onBlockStart?.(block.id, block.type);
      if (block.type === "text" && block.content) {
        callbacks.onBlockDelta?.(block.id, block.content);
      }
      callbacks.onBlockEnd?.(block.id);
    }

    return {
      prompt: activePrompt,
      blocks: streamingBlocks,
    };
  }

  /**
   * Create user message and start assistant response (compatibility method)
   */
  async createUserMessage(
    conversationId: number,
    content: string,
    model = "claude-sonnet-4-20250514",
  ): Promise<{ userMessageId: number; promptId: number }> {
    // Queue the message and get the response
    const userMessageId = await this.queueMessage(conversationId, content);

    // Get the active prompt that should have been created
    const activePrompt = await this.getActivePrompt(conversationId);

    return {
      userMessageId,
      promptId: activePrompt?.id || 0, // Fallback for compatibility
    };
  }

  /**
   * Get prompt by ID (compatibility method)
   */
  async getPromptById(promptId: number) {
    const [prompt] = await this.db
      .select()
      .from(prompts)
      .where(eq(prompts.id, promptId));

    return prompt || null;
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

Execute the commands and then explain the results in a helpful way.`;
  }

  private async handlePromptCreated(
    conversationId: number,
    promptId: number,
  ): Promise<void> {
    await this.db
      .update(conversations)
      .set({ activePromptId: promptId, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    this.logger.info("Prompt created", {
      conversationId,
      promptId,
    });
  }

  private async handlePromptComplete(
    conversationId: number,
    assistantMessageId: number,
    promptId: number,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(messages)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(messages.id, assistantMessageId));

      await tx
        .update(conversations)
        .set({ activePromptId: null, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    });

    this.logger.info("Prompt completed", {
      conversationId,
      promptId,
      assistantMessageId,
    });

    this.processQueue(conversationId).catch((err) => {
      this.logger.error("Failed to process next queued message", {
        conversationId,
        error: err,
      });
    });
  }

  private async handlePromptError(
    conversationId: number,
    userMessageId: number,
    assistantMessageId: number,
    promptId: number | null,
    error: Error,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(messages)
        .set({ status: "queued", updatedAt: new Date() })
        .where(eq(messages.id, userMessageId));

      await tx
        .update(messages)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(messages.id, assistantMessageId));

      await tx
        .update(conversations)
        .set({ activePromptId: null, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    });

    this.logger.error("Prompt failed", {
      conversationId,
      userMessageId,
      assistantMessageId,
      promptId,
      error,
    });
  }
}
