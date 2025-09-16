import type Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import type { DB } from "../db";
import { users, type BlockType } from "../db/schema";
import { expect } from "vitest";
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
    truncateAll,
    insertUser: (email: string) =>
      db.insert(users).values({ email }).returning(),
    db,
  };
}

interface ExpectedBlock {
  type: BlockType;
  content?: string;
}

interface ExpectedMessage {
  role: string;
  status?: string;
  blocks?: ExpectedBlock[];
}

export function expectMessagesState(
  actual: Array<{
    role: string;
    status?: string;
    blocks?: Array<{ type: BlockType; content: string | null }>;
  }> | undefined,
  expected: ExpectedMessage[],
) {
  const actualList = actual ?? [];
  expect(actualList.length).toBe(
    expected.length,
  );

  actualList.forEach((message, index) => {
    const spec = expected[index];
    expect(spec).toBeDefined();
    if (!spec) return;
    expect(message.role).toBe(spec.role);
    if (spec.status !== undefined) {
      expect(message.status).toBe(spec.status);
    }

    if (spec.blocks) {
      const blocks = message.blocks ?? [];
      expect(blocks.length).toBe(spec.blocks.length);
      blocks.forEach((block, blockIndex) => {
        const blockSpec = spec.blocks?.[blockIndex];
        expect(blockSpec).toBeDefined();
        if (!blockSpec) return;
        expect(block.type).toBe(blockSpec.type);
        if (blockSpec.content !== undefined) {
          expect(block.content ?? "").toBe(blockSpec.content);
        }
      });
    }
  });
}
