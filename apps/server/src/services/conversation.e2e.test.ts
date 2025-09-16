import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "../db/schema";
import {
  createConversationServiceFixture,
  expectMessagesState,
} from "../test/conversationServiceFixture";
import { setupTestDatabase, teardownTestDatabase, testDb } from "../test/setup";
import { ConversationService } from "./conversationService";

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

const waitFor = async (
  predicate: () => Promise<boolean>,
  attempts = 20,
  delayMs = 25,
) => {
  for (let i = 0; i < attempts; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error("Condition not met within timeout");
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
    expect(
      new Date(state?.conversation.createdAt ?? 0).getTime(),
    ).toBeGreaterThan(0);
    expect(
      new Date(state?.conversation.updatedAt ?? 0).getTime(),
    ).toBeGreaterThan(0);
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
    for (const events of streams) {
      fixture.enqueueStream(events);
    }

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

    const activePrompt =
      await fixture.conversationService.getActivePrompt(conversationId);
    expect(activePrompt).toBeNull();
  });

  it("exposes active prompt state while streaming", async () => {
    const fixture = createConversationServiceFixture(testDb);
    const streamController = fixture.enqueueStream([], { autoFinish: false });

    const [user] = await fixture.insertUser("stream@example.com");
    const conversationId = await fixture.conversationService.createConversation(
      user.id,
      "Streaming",
    );

    const queuePromise = fixture.conversationService.queueMessage(
      conversationId,
      "Start streaming",
    );

    await waitFor(async () => {
      const current = await fixture.conversationService.getConversation(
        conversationId,
        user.id,
      );
      return (current?.messages?.length ?? 0) === 2;
    });

    streamController.push({
      type: "message_start",
      message: {
        id: "msg_stream",
        role: "assistant",
        content: [],
        model: "claude-sonnet-4-20250514",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    });
    streamController.push({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    streamController.push({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Partial..." },
    });

    await waitFor(async () => {
      const current = await fixture.conversationService.getConversation(
        conversationId,
        user.id,
      );
      const assistant = current?.messages?.find((m) => m.role === "assistant");
      return (
        assistant?.blocks?.some((b) => b.content === "Partial...") ?? false
      );
    });

    const conversationState = await fixture.conversationService.getConversation(
      conversationId,
      user.id,
    );

    expect(conversationState).not.toBeNull();
    expectMessagesState(conversationState?.messages, [
      {
        role: "user",
        status: "completed",
        blocks: [{ type: "text", content: "Start streaming" }],
      },
      {
        role: "assistant",
        status: "processing",
        blocks: [{ type: "text", content: "Partial..." }],
      },
    ]);

    const activePrompt =
      await fixture.conversationService.getActivePrompt(conversationId);
    expect(activePrompt).not.toBeNull();
    expect(activePrompt?.status).toBe("streaming");

    const blockEvents: Array<
      | { type: "start"; blockId: number; blockType: string }
      | { type: "delta"; blockId: number; content: string }
      | { type: "end"; blockId: number }
    > = [];
    let restoredPromptId: number | null = null;

    const restored = await fixture.conversationService.restoreActiveStream(
      conversationId,
      {
        onPromptCreated: (promptId) => {
          restoredPromptId = promptId;
        },
        onBlockStart: (blockId, blockType) => {
          blockEvents.push({ type: "start", blockId, blockType });
        },
        onBlockDelta: (blockId, content) => {
          blockEvents.push({ type: "delta", blockId, content });
        },
        onBlockEnd: (blockId) => {
          blockEvents.push({ type: "end", blockId });
        },
      },
    );

    expect(restored).not.toBeNull();
    expect(restoredPromptId).toBe(restored?.prompt.id);
    expect(restored?.prompt.status).toBe("streaming");
    expect(blockEvents.some((e) => e.type === "delta" && e.content === "Partial...")).toBe(true);

    try {
      streamController.push({
        type: "content_block_stop",
        index: 0,
      });
      streamController.push({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      });
      streamController.push({ type: "message_stop" });
    } finally {
      streamController.finish();
      await queuePromise;
    }
  });
});
