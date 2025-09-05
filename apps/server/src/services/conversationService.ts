import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
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

export class ConversationService {
  /**
   * Create a new conversation
   */
  async createConversation(userId: number, title?: string): Promise<number> {
    const [conversation] = await db
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
    const [conversation] = await db
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
    const messagesWithBlocks = await db
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
    const [activePrompt] = await db
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
    const streamingBlocks = await db
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
    model = "claude-3-5-sonnet-20241022",
  ): Promise<{ userMessageId: number; promptId: number }> {
    return await db.transaction(async (tx) => {
      // Create user message
      const [userMessage] = await tx
        .insert(messages)
        .values({
          conversationId,
          role: "user",
          isComplete: true,
        } as NewMessage)
        .returning();

      // Create user message block
      await tx.insert(blocks).values({
        promptId: 0, // Temporary, will be updated when we have a prompt
        // biome-ignore lint/style/noNonNullAssertion: Insert always returns a row
        messageId: userMessage!.id,
        type: "text",
        indexNum: 0,
        content,
        isFinalized: true,
      } as NewBlock);

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

      // Update the user block with the prompt ID
      await tx
        .update(blocks)
        // biome-ignore lint/style/noNonNullAssertion: Insert always returns a row
        .set({ promptId: prompt!.id })
        // biome-ignore lint/style/noNonNullAssertion: Insert always returns a row
        .where(eq(blocks.messageId, userMessage!.id));

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
    return await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.updatedAt));
  }

  /**
   * Build conversation history for AI model
   */
  async buildConversationHistory(conversationId: number) {
    const result = await this.getConversation(conversationId, 0); // TODO: Pass real userId
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
