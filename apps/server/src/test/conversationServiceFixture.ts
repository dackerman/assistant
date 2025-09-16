import type Anthropic from "@anthropic-ai/sdk";
import { eq, sql } from "drizzle-orm";
import type { DB } from "../db";
import {
  blocks,
  conversations,
  messages,
  prompts,
  toolCalls,
  users,
} from "../db/schema";
import { ConversationService } from "../services/conversationService";
import { PromptService } from "../services/promptService";

interface StreamEvent {
  [key: string]: unknown;
}

class StreamIterator {
  constructor(private readonly events: StreamEvent[]) {}

  async *[Symbol.asyncIterator]() {
    for (const event of this.events) {
      yield event;
    }
  }
}

class StubAnthropic {
  constructor(private readonly queue: StreamEvent[][]) {}

  messages = {
    create: async () => new StreamIterator(this.queue.shift() ?? []),
  };
}

export function createConversationServiceFixture(db: DB) {
  const streamQueue: StreamEvent[][] = [];
  const anthropicClient = new StubAnthropic(streamQueue) as unknown as Anthropic;
  const conversationService = new ConversationService(db);
  (conversationService as unknown as { promptService: PromptService }).promptService =
    new PromptService(db, { anthropicClient });

  const truncateAll = async () => {
    await db.execute(sql`
      TRUNCATE TABLE tool_calls RESTART IDENTITY CASCADE;
      TRUNCATE TABLE prompt_events RESTART IDENTITY CASCADE;
      TRUNCATE TABLE prompts RESTART IDENTITY CASCADE;
      TRUNCATE TABLE blocks RESTART IDENTITY CASCADE;
      TRUNCATE TABLE messages RESTART IDENTITY CASCADE;
      TRUNCATE TABLE conversations RESTART IDENTITY CASCADE;
      TRUNCATE TABLE users RESTART IDENTITY CASCADE;
    `);
  };

  return {
    conversationService,
    enqueueStream(events: StreamEvent[]) {
      streamQueue.push(events);
    },
    async getConversationRows() {
      return await db.select().from(conversations);
    },
    async getMessageRows() {
      return await db.select().from(messages);
    },
    async getPromptRows() {
      return await db.select().from(prompts);
    },
    async getBlockRows() {
      return await db.select().from(blocks);
    },
    async getToolCallRows() {
      return await db.select().from(toolCalls);
    },
    truncateAll,
    insertUser: (email: string) =>
      db.insert(users).values({ email }).returning(),
    db,
  };
}
