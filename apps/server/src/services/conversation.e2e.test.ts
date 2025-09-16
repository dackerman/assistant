import { beforeAll, afterAll, describe, expect, it, beforeEach } from "vitest";
import { sql, eq, and } from "drizzle-orm";
import { ConversationService } from "./conversationService";
import { testDb, setupTestDatabase, teardownTestDatabase } from "../test/setup";
import {
  conversations,
  messages,
  prompts,
  blocks,
  users,
} from "../db/schema";

const truncateAll = async () => {
  await testDb.execute(sql`
    TRUNCATE TABLE tool_calls RESTART IDENTITY CASCADE;
    TRUNCATE TABLE prompt_events RESTART IDENTITY CASCADE;
    TRUNCATE TABLE prompts RESTART IDENTITY CASCADE;
    TRUNCATE TABLE blocks RESTART IDENTITY CASCADE;
    TRUNCATE TABLE messages RESTART IDENTITY CASCADE;
    TRUNCATE TABLE conversations RESTART IDENTITY CASCADE;
    TRUNCATE TABLE users RESTART IDENTITY CASCADE;
  `);
};

describe("ConversationService – createConversation", () => {
  let service: ConversationService;

  beforeAll(async () => {
    await setupTestDatabase();
    service = new ConversationService(testDb);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("creates a conversation row for the provided user", async () => {
    const [user] = await testDb
      .insert(users)
      .values({ email: "creator@example.com" })
      .returning();

    expect(user).toBeDefined();

    const title = "Project Sync";
    const conversationId = await service.createConversation(user.id, title);

    const [row] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    expect(row).toBeDefined();
    expect(row?.userId).toBe(user.id);
    expect(row?.title).toBe(title);
    expect(new Date(row?.createdAt ?? 0).getTime()).toBeGreaterThan(0);
    expect(new Date(row?.updatedAt ?? 0).getTime()).toBeGreaterThan(0);
  });

  it("queues the first user message and starts streaming", async () => {
    const originalPromptService = (service as unknown as { promptService: unknown })
      .promptService;

    const fakePromptService = {
      async createAndStreamPrompt(
        params: { conversationId: number; messageId: number },
        callbacks?: {
          onPromptCreated?: (promptId: number) => void | Promise<void>;
          onComplete?: (promptId: number) => void | Promise<void>;
        },
      ) {
        const [prompt] = await testDb
          .insert(prompts)
          .values({
            conversationId: params.conversationId,
            messageId: params.messageId,
            status: "streaming",
            model: "claude-sonnet-4-20250514",
          })
          .returning();

        await callbacks?.onPromptCreated?.(prompt.id);

        await testDb
          .update(prompts)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(prompts.id, prompt.id));

        await callbacks?.onComplete?.(prompt.id);
        return prompt.id;
      },
    };

    (service as unknown as { promptService: unknown }).promptService =
      fakePromptService;

    try {
      const [user] = await testDb
        .insert(users)
        .values({ email: "queue@example.com" })
        .returning();
      const conversationId = await service.createConversation(
        user.id,
        "Queue Test",
      );

      const messageId = await service.queueMessage(
        conversationId,
        "Hello there",
      );

      const [userMessage] = await testDb
        .select()
        .from(messages)
        .where(eq(messages.id, messageId));
      expect(userMessage.status).toBe("completed");

      const assistantMessages = await testDb
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.role, "assistant"),
          ),
        );
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0].status).toBe("completed");

      const [conversationRow] = await testDb
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId));
      expect(conversationRow.activePromptId).toBeNull();

      const promptRows = await testDb
        .select()
        .from(prompts)
        .where(eq(prompts.conversationId, conversationId));
      expect(promptRows).toHaveLength(1);
      expect(promptRows[0].status).toBe("completed");

      const userBlocks = await testDb
        .select()
        .from(blocks)
        .where(eq(blocks.messageId, userMessage.id));
      expect(userBlocks).toHaveLength(1);
      expect(userBlocks[0].content).toBe("Hello there");
    } finally {
      (service as unknown as { promptService: unknown }).promptService =
        originalPromptService;
    }
  });
});
