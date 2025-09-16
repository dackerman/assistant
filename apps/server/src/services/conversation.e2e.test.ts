import { beforeAll, afterAll, describe, expect, it, beforeEach } from "vitest";
import { sql, eq, and } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { ConversationService } from "./conversationService";
import { testDb, setupTestDatabase, teardownTestDatabase } from "../test/setup";
import {
  conversations,
  messages,
  prompts,
  blocks,
  users,
} from "../db/schema";
import { PromptService } from "./promptService";


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
    class StubStream {
      constructor(private events: Array<Record<string, unknown>>) {}
      async *[Symbol.asyncIterator]() {
        for (const event of this.events) {
          yield event;
        }
      }
    }

    class StubAnthropic {
      constructor(
        private queue: Array<Array<Record<string, unknown>>>,
      ) {}

      messages = {
        create: async () => new StubStream(this.queue.shift() ?? []),
      };
    }

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

    const streamingService = new ConversationService(testDb);
    (streamingService as unknown as { promptService: PromptService }).promptService =
      new PromptService(testDb, {
        anthropicClient: new StubAnthropic(streams) as unknown as Anthropic,
      });

    const [user] = await testDb
      .insert(users)
      .values({ email: "queue@example.com" })
      .returning();
    const conversationId = await streamingService.createConversation(
      user.id,
      "Queue Test",
    );

    const messageId = await streamingService.queueMessage(
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
  });
});
