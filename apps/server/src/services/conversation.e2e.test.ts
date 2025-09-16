import { beforeAll, afterAll, describe, expect, it, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { ConversationService } from "./conversationService";
import { testDb, setupTestDatabase, teardownTestDatabase } from "../test/setup";
import { conversations, users } from "../db/schema";

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
});
