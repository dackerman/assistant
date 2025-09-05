import { and, desc, eq } from "drizzle-orm";
import { db as defaultDb } from "../db";
import type { DB } from "../db";
import {
  type Block,
  type NewBlock,
  type NewConversation,
  type NewMessage,
  type NewPrompt,
  blocks,
  conversations,
  messages,
  prompts,
} from "../db/schema";
import { Logger } from "../utils/logger";

export class ConversationService {
  private db: DB;
  private logger: Logger;

  constructor(dbInstance: DB = defaultDb) {
    this.db = dbInstance;
    this.logger = new Logger({ service: "ConversationService" });
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

    // biome-ignore lint/style/noNonNullAssertion: Insert always returns a row
    return conversation!.id;
  }

  /**
   * Get conversation with all messages and blocks
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
          eq(messages.isComplete, true),
        ),
      )
      .orderBy(messages.createdAt, blocks.indexNum);

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
        // biome-ignore lint/style/noNonNullAssertion: We know the message exists in the map
        messageMap.get(row.message.id)!.blocks.push(row.block);
      }
    }

    return {
      conversation,
      messages: Array.from(messageMap.values()),
    };
  }

  /**
   * Get active streaming state for a conversation
   */
  async getActiveStream(conversationId: number) {
    // Get active prompt
    const [activePrompt] = await this.db
      .select()
      .from(prompts)
      .where(
        and(
          eq(prompts.conversationId, conversationId),
          eq(prompts.state, "IN_PROGRESS"),
        ),
      );

    if (!activePrompt) {
      return null;
    }

    // Get streaming blocks (not yet finalized)
    const streamingBlocks = await this.db
      .select()
      .from(blocks)
      .where(
        and(
          eq(blocks.promptId, activePrompt.id),
          eq(blocks.isFinalized, false),
        ),
      )
      .orderBy(blocks.indexNum);

    return {
      prompt: activePrompt,
      blocks: streamingBlocks,
    };
  }

  /**
   * Create a user message and start assistant response
   */
  async createUserMessage(
    conversationId: number,
    content: string,
    model = "claude-sonnet-4-20250514",
  ): Promise<{ userMessageId: number; promptId: number }> {
    const serviceLogger = this.logger.child({
      conversationId,
      contentLength: content.length,
      model,
    });

    serviceLogger.info("Creating user message and starting assistant response");

    return await this.db.transaction(async (tx: DB) => {
      // Create user message
      const userMessageRecord = {
        conversationId,
        role: "user",
        isComplete: true,
      } as NewMessage;

      serviceLogger.info("Creating user message record", {
        table: "messages",
        record: userMessageRecord,
      });

      const [userMessage] = await tx
        .insert(messages)
        .values(userMessageRecord)
        .returning();

      serviceLogger.info("User message created", {
        userMessageId: userMessage?.id,
        conversationId: userMessage?.conversationId,
      });

      // Create assistant message placeholder
      const [assistantMessage] = await tx
        .insert(messages)
        .values({
          conversationId,
          role: "assistant",
          isComplete: false,
        } as NewMessage)
        .returning();

      // Create prompt for streaming
      const [prompt] = await tx
        .insert(prompts)
        .values({
          conversationId,
          // biome-ignore lint/style/noNonNullAssertion: Insert always returns a row
          messageId: assistantMessage!.id,
          state: "CREATED",
          model,
          systemMessage: "You are a helpful assistant.",
        } as NewPrompt)
        .returning();

      // Create a separate prompt for the user message
      const [userPrompt] = await tx
        .insert(prompts)
        .values({
          conversationId,
          // biome-ignore lint/style/noNonNullAssertion: Insert always returns a row
          messageId: userMessage!.id,
          state: "COMPLETED", // User messages are immediately complete
          model: "user", // Not an AI model, just a marker
          systemMessage: null,
        } as NewPrompt)
        .returning();

      // Create user message block with its own prompt
      await tx.insert(blocks).values({
        // biome-ignore lint/style/noNonNullAssertion: Insert always returns a row
        promptId: userPrompt!.id,
        // biome-ignore lint/style/noNonNullAssertion: Insert always returns a row
        messageId: userMessage!.id,
        type: "text",
        indexNum: 0, // User messages have simple indexing starting from 0
        content,
        isFinalized: true,
      });

      // Update conversation's active prompt
      await tx
        .update(conversations)
        // biome-ignore lint/style/noNonNullAssertion: Insert always returns a row
        .set({ activePromptId: prompt!.id })
        .where(eq(conversations.id, conversationId));

      return {
        // biome-ignore lint/style/noNonNullAssertion: Insert always returns a row
        userMessageId: userMessage!.id,
        // biome-ignore lint/style/noNonNullAssertion: Insert always returns a row
        promptId: prompt!.id,
      };
    });
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
   * Get prompt by ID
   */
  async getPromptById(promptId: number) {
    const [prompt] = await this.db
      .select()
      .from(prompts)
      .where(eq(prompts.id, promptId));

    return prompt || null;
  }

  /**
   * Build conversation history for AI model
   */
  async buildConversationHistory(conversationId: number, userId: number) {
    const result = await this.getConversation(conversationId, userId);
    if (!result) return [];

    const history = [];

    for (const message of result.messages) {
      if (message.role === "user") {
        // User message - combine all text blocks
        const content = message.blocks
          .filter((b: Block) => b.type === "text")
          .map((b: Block) => b.content)
          .join("");

        history.push({
          role: "user",
          content,
        });
      } else if (message.role === "assistant") {
        // Assistant message - only include text blocks (not thinking/tool_call)
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
}
