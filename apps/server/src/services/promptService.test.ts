import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prompts, promptEvents } from "../db/index.js";
import { setupTestDatabase, teardownTestDatabase, testDb } from "../test/setup";
import { PromptService } from "./promptService";
import type { ToolExecutorService } from "./toolExecutorService";
import type { Logger } from "../utils/logger.js";

// Mock Anthropic streaming events for a simple text response
function createMockStreamingResponse(): AsyncIterable<Anthropic.Messages.RawMessageStreamEvent> {
  const events: Anthropic.Messages.RawMessageStreamEvent[] = [
    {
      type: "message_start",
      message: {
        id: "msg_test123",
        role: "assistant",
        content: [],
        model: "claude-4-sonnet-20250514",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 }
      }
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "text",
        text: ""
      }
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "text_delta",
        text: "Hello"
      }
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "text_delta",
        text: " world"
      }
    },
    {
      type: "content_block_stop",
      index: 0
    },
    {
      type: "message_delta",
      delta: {
        stop_reason: "end_turn",
        stop_sequence: null
      },
      usage: { output_tokens: 2 }
    },
    {
      type: "message_stop"
    }
  ];

  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    }
  };
}

describe("PromptService", () => {
  let service: PromptService;
  let mockAnthropicClient: any;
  let mockToolExecutor: ToolExecutorService;
  let mockLogger: Logger;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    // Clean tables
    await testDb.delete(promptEvents);
    await testDb.delete(prompts);

    // Create mocks
    mockAnthropicClient = {
      messages: {
        create: vi.fn()
      }
    };

    mockToolExecutor = {} as ToolExecutorService;

    mockLogger = {
      child: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      }),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    } as any;

    service = new PromptService(
      mockAnthropicClient,
      testDb,
      mockToolExecutor,
      mockLogger
    );
  });

  it("processes streaming response without tool calls and marks prompt as completed", async () => {
    // Setup mock streaming response
    const mockStream = createMockStreamingResponse();
    mockAnthropicClient.messages.create.mockResolvedValue(mockStream);

    // Test messages to send
    const messages: Anthropic.Messages.MessageParam[] = [
      { role: "user", content: "Hello" }
    ];

    // Call the prompt method
    await service.prompt(messages);

    // Verify prompt was created and completed
    const allPrompts = await testDb.select().from(prompts);
    expect(allPrompts).toHaveLength(1);
    
    const prompt = allPrompts[0];
    expect(prompt.provider).toBe("anthropic");
    expect(prompt.model).toBe("claude-4-sonnet-20250514");
    expect(prompt.state).toBe("completed");
    expect(prompt.request).toEqual({
      model: "claude-4-sonnet-20250514",
      max_tokens: 50000,
      stream: true,
      messages
    });
    expect(prompt.completedAt).toBeDefined();

    // Verify events were stored
    const allEvents = await testDb.select().from(promptEvents);
    expect(allEvents.length).toBeGreaterThan(0);
    
    // Verify each streaming event was stored
    const eventTypes = allEvents.map((e: any) => e.event.type);
    expect(eventTypes).toContain("message_start");
    expect(eventTypes).toContain("content_block_start");
    expect(eventTypes).toContain("content_block_delta");
    expect(eventTypes).toContain("content_block_stop");
    expect(eventTypes).toContain("message_stop");

    // Verify Anthropic client was called correctly
    expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith({
      model: "claude-4-sonnet-20250514",
      max_tokens: 50000,
      stream: true,
      messages
    });
  });
});