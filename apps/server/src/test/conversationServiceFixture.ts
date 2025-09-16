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

class ControlledStream {
  private events: StreamEvent[] = [];
  private resolvers: ((result: IteratorResult<StreamEvent>) => void)[] = [];
  private done = false;

  push(event: StreamEvent) {
    if (this.done) {
      throw new Error("Stream already finished");
    }
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value: event, done: false });
    } else {
      this.events.push(event);
    }
  }

  finish() {
    if (this.done) return;
    this.done = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      resolver?.({ value: undefined as unknown as StreamEvent, done: true });
    }
  }

  [Symbol.asyncIterator]() {
    return {
      next: (): Promise<IteratorResult<StreamEvent>> => {
        if (this.events.length > 0) {
          const value = this.events.shift()!;
          return Promise.resolve({ value, done: false });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as unknown as StreamEvent, done: true });
        }
        return new Promise((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}

class StubAnthropic {
  constructor(private readonly queue: ControlledStream[]) {}

  messages = {
    create: async () => this.queue.shift() ?? new ControlledStream(),
  };
}

export function createConversationServiceFixture(db: DB) {
  const streamQueue: ControlledStream[] = [];
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
    enqueueStream(initialEvents: StreamEvent[] = [], options?: { autoFinish?: boolean }) {
      const controller = new ControlledStream();
      initialEvents.forEach((event) => controller.push(event));
      if (options?.autoFinish !== false) {
        controller.finish();
      }
      streamQueue.push(controller);
      return {
        push: (event: StreamEvent) => controller.push(event),
        finish: () => controller.finish(),
      };
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

type BlockEventExpectation =
  | { type: "start"; blockType: BlockType }
  | { type: "delta"; content: string }
  | { type: "end" };

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

export function expectBlockEvents(
  actual:
    | Array<
        | { type: "start"; blockId: number; blockType: string }
        | { type: "delta"; blockId: number; content: string }
        | { type: "end"; blockId: number }
      >
    | undefined,
  expected: BlockEventExpectation[],
) {
  const list = actual ?? [];
  expect(list.length).toBe(expected.length);

  list.forEach((event, index) => {
    const spec = expected[index];
    expect(spec).toBeDefined();
    if (!spec) return;
    expect(event.type).toBe(spec.type);

    if (spec.type === "start") {
      expect((event as { blockType: string }).blockType).toBe(spec.blockType);
    } else if (spec.type === "delta") {
      expect((event as { content: string }).content).toBe(spec.content);
    }
  });
}
