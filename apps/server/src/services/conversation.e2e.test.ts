import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "../db/schema";
import {
  createConversationServiceFixture,
  expectMessagesState,
} from "../test/conversationServiceFixture";
import { setupTestDatabase, teardownTestDatabase, testDb } from "../test/setup";
import {
  ConversationService,
  type ConversationStreamEvent,
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

  it("streams conversation events across prompts", async () => {
    const fixture = createConversationServiceFixture(testDb);
    const firstStreamController = fixture.enqueueStream([], {
      autoFinish: false,
    });
    let secondStreamController: ReturnType<
      typeof fixture.enqueueStream
    > | null = null;

    const [user] = await fixture.insertUser("stream@example.com");
    const conversationId = await fixture.conversationService.createConversation(
      user.id,
      "Streaming",
    );

    const stream = await fixture.conversationService.streamConversation(
      conversationId,
      user.id,
    );

    expect(stream).not.toBeNull();
    if (!stream) return;

    expect(stream.snapshot.conversation.id).toBe(conversationId);
    expect(stream.snapshot.messages).toHaveLength(0);

    const iterator = stream.events[Symbol.asyncIterator]();
    const events: ConversationStreamEvent[] = [];

    const nextEvent = async () => {
      const { value, done } = await iterator.next();
      expect(done).toBe(false);
      expect(value).toBeDefined();
      events.push(value);
      return value as ConversationStreamEvent;
    };

    const expectEvent = async <T extends ConversationStreamEvent["type"]>(
      type: T,
      assert?:
        | Extract<ConversationStreamEvent, { type: T }>
        | ((event: Extract<ConversationStreamEvent, { type: T }>) => void),
    ) => {
      const typed = await nextEvent();
      console.log("event:", typed);
      expect(typed.type).toBe(type);
      if (typeof assert === "function") {
        assert(typed as Extract<ConversationStreamEvent, { type: T }>);
      } else if (assert) {
        expect(assert).toEqual(typed);
      }
      return typed as Extract<ConversationStreamEvent, { type: T }>;
    };

    let firstQueuePromise: Promise<number> | null = null;
    let secondQueuePromise: Promise<number> | null = null;

    try {
      // First prompt
      firstQueuePromise = fixture.conversationService.queueMessage(
        conversationId,
        "What's the weather in Tokyo?",
      );

      await expectEvent("message-created", (event) => {
        expect(event.message.role).toBe("user");
        expect(event.message.content).toBe("What's the weather in Tokyo?");
      });

      await expectEvent("message-updated", (event) => {
        expect(event.message.role).toBe("user");
        expect(event.message.status).toBe("processing");
      });

      await expectEvent("message-created", (event) => {
        expect(event.message.role).toBe("assistant");
        expect(event.message.status).toBe("processing");
      });

      await expectEvent("message-updated", (event) => {
        expect(event.message.role).toBe("user");
        expect(event.message.status).toBe("completed");
      });

      const firstPromptStarted = await expectEvent("prompt-started");

      firstStreamController.push({
        type: "message_start",
        message: {
          id: "prompt-1",
          role: "assistant",
          content: [],
          model: "claude-sonnet-4-20250514",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      });
      firstStreamController.push({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      });
      firstStreamController.push({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Great Quest" },
      });

      // Events stream in before blocks are finished
      await expectEvent("block-start", (event) => {
        expect(event.promptId).toBe(firstPromptStarted.prompt.id);
      });
      await expectEvent("block-delta", (event) => {
        expect(event.promptId).toBe(firstPromptStarted.prompt.id);
        expect(event.content).toBe("Great Quest");
      });

      // If a user connects to the stream at this point, the snapshot will show a partial block
      const midConnectingStream =
        await fixture.conversationService.streamConversation(
          conversationId,
          user.id,
        );
      expect(normalizeDates(midConnectingStream?.snapshot)).toMatchSnapshot(
        "mid connecting snapshot",
      );
      midConnectingStream?.events.return?.(undefined);

      firstStreamController.push({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text: `ion!\n\n. It's sunny and 70 degrees.`,
        },
      });

      firstStreamController.push({ type: "content_block_stop", index: 0 });
      firstStreamController.push({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 2 },
      });
      firstStreamController.push({ type: "message_stop" });
      firstStreamController.finish();

      await expectEvent("block-delta", (event) => {
        expect(event.promptId).toBe(firstPromptStarted.prompt.id);
        expect(event.content).toBe("ion!\n\n. It's sunny and 70 degrees.");
      });
      await expectEvent("block-end", (event) => {
        expect(event.promptId).toBe(firstPromptStarted.prompt.id);
      });
      await expectEvent("prompt-completed", (event) => {
        expect(event.prompt.id).toBe(firstPromptStarted.prompt.id);
      });
      await expectEvent("message-updated", (event) => {
        expect(event.message.role).toBe("assistant");
        expect(event.message.status).toBe("completed");
      });
      await firstQueuePromise;

      // Second prompt
      secondStreamController = fixture.enqueueStream([], { autoFinish: false });
      secondQueuePromise = fixture.conversationService.queueMessage(
        conversationId,
        "Tell me a quick joke",
      );

      await expectEvent("message-created", (event) => {
        expect(event.message.role).toBe("user");
        expect(event.message.content).toBe("Tell me a quick joke");
      });
      await expectEvent("message-updated", (event) => {
        expect(event.message.role).toBe("user");
        expect(event.message.status).toBe("processing");
      });
      await expectEvent("message-created", (event) => {
        expect(event.message.role).toBe("assistant");
        expect(event.message.status).toBe("processing");
      });
      await expectEvent("message-updated", (event) => {
        expect(event.message.role).toBe("user");
        expect(event.message.status).toBe("completed");
      });

      const secondPromptStarted = await expectEvent("prompt-started");

      secondStreamController.push({
        type: "message_start",
        message: {
          id: "prompt-2",
          role: "assistant",
          content: [],
          model: "claude-sonnet-4-20250514",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      });
      secondStreamController.push({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      });
      secondStreamController.push({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Here is a joke." },
      });

      secondStreamController.push({ type: "content_block_stop", index: 0 });
      secondStreamController.push({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 2 },
      });
      secondStreamController.push({ type: "message_stop" });
      secondStreamController.finish();

      await expectEvent("block-start", (event) => {
        expect(event.promptId).toBe(secondPromptStarted.prompt.id);
      });
      await expectEvent("block-delta", (event) => {
        expect(event.promptId).toBe(secondPromptStarted.prompt.id);
        expect(event.content).toBe("Here is a joke.");
      });
      await expectEvent("block-end", (event) => {
        expect(event.promptId).toBe(secondPromptStarted.prompt.id);
      });
      await expectEvent("prompt-completed", (event) => {
        expect(event.prompt.id).toBe(secondPromptStarted.prompt.id);
      });
      await secondQueuePromise;

      const blockDeltas = events
        .filter((event) => event.type === "block-delta")
        .map((event) => "content" in event && event.content);

      expect(blockDeltas).toEqual([
        "Great Quest",
        "ion!\n\n. It's sunny and 70 degrees.",
        "Here is a joke.",
      ]);

      expect(
        events.filter((event) => event.type === "prompt-completed").length,
      ).toBe(2);

      expect(
        events.filter(
          (event) =>
            event.type === "message-created" && event.message.role === "user",
        ).length,
      ).toBe(2);
      expect(
        events.filter(
          (event) =>
            event.type === "message-created" &&
            event.message.role === "assistant",
        ).length,
      ).toBe(2);

      expect(normalizeDates(events)).toMatchSnapshot("all events");

      // If a user connects to the stream after the conversation is complete, they should see the final state of the conversation
      const lateConnectingStream =
        await fixture.conversationService.streamConversation(
          conversationId,
          user.id,
        );

      expect(normalizeDates(lateConnectingStream?.snapshot)).toMatchSnapshot(
        "final snapshot",
      );
      lateConnectingStream?.events.return?.(undefined);
    } finally {
      firstStreamController.finish();
      secondStreamController?.finish();
      await firstQueuePromise?.catch(() => undefined);
      await secondQueuePromise?.catch(() => undefined);
      await iterator.return?.(undefined);
    }
  });
});

/**
 * Accepts any array or object and recursively replace any date properties with the string "Any<Date>"
 */
function normalizeDates(obj: unknown) {
  if (obj instanceof Date) {
    return "Any<Date>";
  }
  if (Array.isArray(obj)) {
    return obj.map(normalizeDates);
  }
  if (typeof obj === "object" && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, normalizeDates(value)]),
    );
  }
  return obj;
}
