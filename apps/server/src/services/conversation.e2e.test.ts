import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "../db/schema";
import {
  createConversationServiceFixture,
  expectBlockEvents,
  expectMessagesState,
} from "../test/conversationServiceFixture";
import { setupTestDatabase, teardownTestDatabase, testDb } from "../test/setup";
import {
  ConversationService,
  type ConversationState,
  type RestoredStreamEvent,
} from "./conversationService";

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

    // Create conversation and queue user prompt
    const [user] = await fixture.insertUser("stream@example.com");
    const conversationId = await fixture.conversationService.createConversation(
      user.id,
      "Streaming",
    );

    // Initial user prompt
    const queuePromise = fixture.conversationService.queueMessage(
      conversationId,
      "What's the weather in Tokyo?",
    );

    const convoContainer: { convo: ConversationState | null } = { convo: null };

    await waitFor(async () => {
      convoContainer.convo = await fixture.conversationService.getConversation(
        conversationId,
        user.id,
      );
      return (convoContainer.convo?.messages?.length ?? 0) === 2;
    });

    // User prompt and empty assistant response exists before streaming starts
    expectMessagesState(convoContainer.convo?.messages, [
      {
        role: "user",
        status: "completed",
        blocks: [{ type: "text", content: "What's the weather in Tokyo?" }],
      },
      {
        role: "assistant",
        status: "processing",
        blocks: [{ type: "text", content: "" }],
      },
    ]);

    // Start streaming assistant response
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
      delta: { type: "text_delta", text: "That's a g" },
    });

    await waitFor(async () => {
      convoContainer.convo = await fixture.conversationService.getConversation(
        conversationId,
        user.id,
      );
      const assistant = convoContainer.convo?.messages?.find(
        (m) => m.role === "assistant",
      );
      return (
        assistant?.blocks?.some((b) => b.content === "Partial...") ?? false
      );
    });

    expect(convoContainer.convo).not.toBeNull();
    expectMessagesState(convoContainer.convo?.messages, [
      {
        role: "user",
        status: "completed",
        blocks: [{ type: "text", content: "What's the weather in Tokyo?" }],
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

    const restored =
      await fixture.conversationService.restoreActiveStream(conversationId);

    expect(restored).not.toBeNull();
    if (!restored) return;

    expect(restored.prompt.id).toBe(activePrompt?.id);
    expect(restored.prompt.status).toBe("streaming");

    const iterator = restored.events[Symbol.asyncIterator]();
    const initialEvents: RestoredStreamEvent[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { value, done } = await iterator.next();
      expect(done).toBe(false);
      expect(value).toBeDefined();
      if (value) {
        initialEvents.push(value);
      }
    }

    expectBlockEvents(initialEvents, [
      { type: "start", blockType: "text" },
      { type: "delta", content: "Partial..." },
      { type: "end" },
    ]);

    try {
      streamController.push({ type: "content_block_stop", index: 0 });
      streamController.push({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      });
      streamController.push({ type: "message_stop" });
    } finally {
      streamController.finish();
      await queuePromise;
      if (iterator?.return) {
        await iterator.return(undefined);
      }
    }
  });
});
