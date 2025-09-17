import type Anthropic from "@anthropic-ai/sdk";
import { eq, sql } from "drizzle-orm";
import { expect } from "vitest";
import type { DB } from "../db";
import { blocks, toolCalls, type BlockType, users } from "../db/schema";
import {
  ConversationService,
  type ConversationStreamEvent,
} from "../services/conversationService";
import { PromptService } from "../services/promptService";
import { ToolExecutorService } from "../services/toolExecutorService";

interface StreamEvent {
  [key: string]: unknown;
}

/**
 * Deterministic async stream used by tests to act as the Anthropic streaming source.
 *
 * The controller receives events via `push`, buffers them when no consumer is
 * waiting, and hands them to the awaiting `next` call in FIFO order. `finish`
 * flushes the waiting resolvers with `done: true` and prevents further pushes.
 *
 * The implementation mirrors an AsyncIterator interface so our fixture can hand
 * it to `PromptService` exactly as if it were the provider SDK stream. Tests can
 * therefore drive the stream by pushing events at specific times and assert that
 * the service reacts correctly.
 */
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
          return Promise.resolve({
            value: undefined as unknown as StreamEvent,
            done: true,
          });
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

/**
 * Bootstrap helper for ConversationService tests. It wires a deterministic
 * Anthropic stub, exposes controls for enqueuing provider events, and returns
 * helpers for common DB setup tasks (users, truncation, etc.).
 */
export function createConversationServiceFixture(db: DB) {
  const streamQueue: ControlledStream[] = [];
  const anthropicClient = new StubAnthropic(
    streamQueue,
  ) as unknown as Anthropic;

  const toolExecutor = new ToolExecutorService(db);
  const executeToolCall = async (toolCallId: number) => {
    const [toolCall] = await db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.id, toolCallId));

    if (!toolCall) {
      throw new Error(`Tool call ${toolCallId} not found`);
    }

    const now = new Date();

    await db
      .update(toolCalls)
      .set({
        state: "executing",
        startedAt: now,
        updatedAt: now,
      })
      .where(eq(toolCalls.id, toolCallId));

    const rawInput = toolCall.input as Record<string, unknown> | null;
    const commandValue = (() => {
      if (!rawInput) return "";
      const commandCandidate = rawInput["command"];
      if (typeof commandCandidate === "string") {
        return commandCandidate;
      }
      const queryCandidate = rawInput["query"];
      if (typeof queryCandidate === "string") {
        return queryCandidate;
      }
      return "";
    })();

    const output = commandValue
      ? `FAKE OUTPUT: ${commandValue}`
      : `FAKE OUTPUT FROM ${toolCall.name}`;

    const completionTime = new Date();

    await db
      .update(toolCalls)
      .set({
        state: "completed",
        output,
        completedAt: completionTime,
        updatedAt: completionTime,
      })
      .where(eq(toolCalls.id, toolCallId));

    if (toolCall.blockId) {
      await db
        .update(blocks)
        .set({
          type: "tool_result",
          content: output,
          updatedAt: completionTime,
        })
        .where(eq(blocks.id, toolCall.blockId));
    }
  };

  (toolExecutor as ToolExecutorService & {
    executeToolCall(toolCallId: number): Promise<void>;
  }).executeToolCall = executeToolCall;

  const promptService = new PromptService(db, {
    anthropicClient,
    toolExecutor,
  });
  const conversationService = new ConversationService(db, { promptService });

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
    enqueueStream(
      initialEvents: StreamEvent[] = [],
      options?: { autoFinish?: boolean },
    ) {
      const controller = new ControlledStream();
      for (const event of initialEvents) {
        controller.push(event);
      }
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

/**
 * Assertion helper that validates message state against a compact spec.
 * It compares role, status, and block contents in order, providing clear
 * failures when the DB representation diverges from expectations.
 */
export function expectMessagesState(
  actual:
    | Array<{
        role: string;
        status?: string;
        blocks?: Array<{ type: BlockType; content: string | null }>;
      }>
    | undefined,
  expected: ExpectedMessage[],
) {
  const actualList = actual ?? [];
  expect(actualList.length).toBe(expected.length);

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

/**
 * Assertion helper to verify block start/delta/end events while ignoring
 * ephemeral IDs. It normalizes the events before comparing to the expected
 * shape, making the tests concise yet robust.
 */
export function expectBlockEvents(
  actual: ConversationStreamEvent[] | undefined,
  expected: BlockEventExpectation[],
) {
  const list = (actual ?? [])
    .filter(
      (event) =>
        event.type === "block-start" ||
        event.type === "block-delta" ||
        event.type === "block-end",
    )
    .map((event) => {
      if (event.type === "block-start") {
        return { type: "start", blockType: event.blockType };
      }
      if (event.type === "block-delta") {
        return { type: "delta", content: event.content };
      }
      return { type: "end" };
    });

  expect(list).toEqual(expected);
}
