import { beforeAll, afterAll, describe, expect, it, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { ConversationService } from "./conversationService";
import { testDb, setupTestDatabase, teardownTestDatabase } from "../test/setup";
import {
  createConversationServiceFixture,
  expectMessagesState,
} from "../test/conversationServiceFixture";
import { users } from "../db/schema";


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
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("creates a conversation row for the provided user", async () => {
    const service = new ConversationService(testDb);
    const [user] = await testDb
      .insert(users)
      .values({ email: "creator@example.com" })
      .returning();

    expect(user).toBeDefined();

    const title = "Project Sync";
    const conversationId = await service.createConversation(user.id, title);

    const state = await service.getConversation(conversationId, user.id);
    expect(state).not.toBeNull();
    expect(state?.conversation.id).toBe(conversationId);
    expect(state?.conversation.userId).toBe(user.id);
    expect(state?.conversation.title).toBe(title);
    expect(new Date(state?.conversation.createdAt ?? 0).getTime()).toBeGreaterThan(0);
    expect(new Date(state?.conversation.updatedAt ?? 0).getTime()).toBeGreaterThan(0);
    expectMessagesState(state?.messages, []);
  });

  it("queues the first user message and starts streaming", async () => {
    const streams = [
      [
        {
          type: "message_start",
          message: {
            id: "msg_test",
            role: "assistant",
            content: [],
            model: "claude-sonnet-4-20250514",
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hi!" },
        },
        {
          type: "content_block_stop",
          index: 0,
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 1 },
        },
        { type: "message_stop" },
      ],
    ];

    const fixture = createConversationServiceFixture(testDb);
    streams.forEach((events) => fixture.enqueueStream(events));

    const [user] = await fixture.insertUser("queue@example.com");
    const conversationId = await fixture.conversationService.createConversation(
      user.id,
      "Queue Test",
    );

    await fixture.conversationService.queueMessage(
      conversationId,
      "Hello there",
    );

    const state = await fixture.conversationService.getConversation(
      conversationId,
      user.id,
    );

    expect(state).not.toBeNull();
    expectMessagesState(state?.messages, [
      {
        role: "user",
        status: "completed",
        blocks: [{ type: "text", content: "Hello there" }],
      },
      {
        role: "assistant",
        status: "completed",
        blocks: [{ type: "text", content: "Hi!" }],
      },
    ]);

    expect(state?.conversation.activePromptId).toBeNull();

    const activePrompt = await fixture.conversationService.getActivePrompt(
      conversationId,
    );
    expect(activePrompt).toBeNull();
  });
});
