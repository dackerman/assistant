import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { StreamingStateMachine } from "./stateMachine";
import { setupTestDatabase, teardownTestDatabase, testDb } from "../test/setup";
import {
  users,
  conversations,
  messages,
  prompts,
  blocks,
  toolCalls,
  events,
} from "../db/schema";
import { eq } from "drizzle-orm";

describe("StreamingStateMachine", () => {
  let userId: number;
  let conversationId: number;
  let promptId: number;
  let messageId: number;
  let stateMachine: StreamingStateMachine;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    // Clean up tables
    await testDb.delete(events);
    await testDb.delete(toolCalls);
    await testDb.delete(blocks);
    await testDb.delete(prompts);
    await testDb.delete(messages);
    await testDb.delete(conversations);
    await testDb.delete(users);

    // Create test data
    const [user] = await testDb
      .insert(users)
      .values({
        email: "test@example.com",
      })
      .returning();
    userId = user.id;

    const [conversation] = await testDb
      .insert(conversations)
      .values({
        userId,
        title: "Test Conversation",
      })
      .returning();
    conversationId = conversation.id;

    const [message] = await testDb
      .insert(messages)
      .values({
        conversationId,
        role: "assistant",
        isComplete: false,
      })
      .returning();
    messageId = message.id;

    const [prompt] = await testDb
      .insert(prompts)
      .values({
        conversationId,
        messageId,
        state: "IN_PROGRESS",
        model: "test-model",
        systemMessage: "Test system message",
      })
      .returning();
    promptId = prompt.id;

    stateMachine = new StreamingStateMachine(promptId);
  });

  describe("processStreamEvent", () => {
    it("should handle block_start event", async () => {
      await stateMachine.processStreamEvent({
        type: "block_start",
        blockType: "text",
        blockIndex: 0,
      });

      // Check block was created
      const [block] = await testDb
        .select()
        .from(blocks)
        .where(eq(blocks.promptId, promptId));

      expect(block).toBeDefined();
      expect(block.type).toBe("text");
      expect(block.indexNum).toBe(0);
      expect(block.content).toBe("");

      // Check event was stored
      const [event] = await testDb
        .select()
        .from(events)
        .where(eq(events.promptId, promptId));

      expect(event).toBeDefined();
      expect(event.type).toBe("block_start");
      expect(event.blockType).toBe("text");
    });

    it("should handle block_delta event", async () => {
      // First create a block
      await stateMachine.processStreamEvent({
        type: "block_start",
        blockType: "text",
        blockIndex: 0,
      });

      // Then send delta
      await stateMachine.processStreamEvent({
        type: "block_delta",
        blockIndex: 0,
        delta: "Hello, ",
      });

      await stateMachine.processStreamEvent({
        type: "block_delta",
        blockIndex: 0,
        delta: "world!",
      });

      // Check block content was updated
      const [block] = await testDb
        .select()
        .from(blocks)
        .where(eq(blocks.promptId, promptId));

      expect(block.content).toBe("Hello, world!");
    });

    it("should handle tool_call block_end event", async () => {
      // Create a tool call block
      await stateMachine.processStreamEvent({
        type: "block_start",
        blockType: "tool_call",
        blockIndex: 0,
      });

      await stateMachine.processStreamEvent({
        type: "block_end",
        blockType: "tool_call",
        blockIndex: 0,
        toolCallData: {
          apiToolCallId: "tool_123",
          toolName: "web_search",
          request: { query: "test search" },
        },
      });

      // Check tool call was created
      const toolCallRecords = await testDb
        .select()
        .from(toolCalls)
        .where(eq(toolCalls.promptId, promptId));

      expect(toolCallRecords).toHaveLength(1);
      expect(toolCallRecords[0].toolName).toBe("web_search");
      expect(toolCallRecords[0].state).toBe("created");
      expect(toolCallRecords[0].request).toEqual({ query: "test search" });
    });
  });

  describe("handleMessageStop", () => {
    it("should complete prompt when no tool calls", async () => {
      await stateMachine.handleMessageStop();

      // Check prompt state
      const [prompt] = await testDb
        .select()
        .from(prompts)
        .where(eq(prompts.id, promptId));

      expect(prompt.state).toBe("COMPLETED");

      // Check message is complete
      const [message] = await testDb
        .select()
        .from(messages)
        .where(eq(messages.id, messageId));

      expect(message.isComplete).toBe(true);
    });

    it("should transition to WAITING_FOR_TOOLS when tool calls exist", async () => {
      // Create a block and tool call
      const [block] = await testDb
        .insert(blocks)
        .values({
          promptId,
          type: "tool_call",
          indexNum: 0,
          content: "",
        })
        .returning();

      await testDb.insert(toolCalls).values({
        promptId,
        blockId: block.id,
        toolName: "test_tool",
        state: "created",
        request: {},
      });

      await stateMachine.handleMessageStop();

      // Check prompt state
      const [prompt] = await testDb
        .select()
        .from(prompts)
        .where(eq(prompts.id, promptId));

      expect(prompt.state).toBe("WAITING_FOR_TOOLS");
    });
  });

  describe("cancel", () => {
    it("should cancel running tool calls and update prompt state", async () => {
      // Create a block and tool call
      const [block] = await testDb
        .insert(blocks)
        .values({
          promptId,
          type: "tool_call",
          indexNum: 0,
          content: "",
        })
        .returning();

      const [toolCall] = await testDb
        .insert(toolCalls)
        .values({
          promptId,
          blockId: block.id,
          toolName: "test_tool",
          state: "running",
          request: {},
        })
        .returning();

      await stateMachine.cancel();

      // Check tool call was canceled
      const [updatedToolCall] = await testDb
        .select()
        .from(toolCalls)
        .where(eq(toolCalls.id, toolCall.id));

      expect(updatedToolCall.state).toBe("canceled");

      // Check prompt state
      const [prompt] = await testDb
        .select()
        .from(prompts)
        .where(eq(prompts.id, promptId));

      expect(prompt.state).toBe("CANCELED");
    });
  });

  describe("resume", () => {
    it("should return already_complete for completed prompts", async () => {
      await testDb
        .update(prompts)
        .set({ state: "COMPLETED" })
        .where(eq(prompts.id, promptId));

      const result = await stateMachine.resume();
      expect(result.status).toBe("already_complete");
    });

    it("should return resume_with_partial for ERROR state", async () => {
      await testDb
        .update(prompts)
        .set({ state: "ERROR", error: "Test error" })
        .where(eq(prompts.id, promptId));

      // Create some partial blocks
      await testDb.insert(blocks).values({
        promptId,
        type: "text",
        indexNum: 0,
        content: "Partial content",
      });

      const result = await stateMachine.resume();
      expect(result.status).toBe("resume_with_partial");
      expect(result.data).toHaveLength(1);
      expect(result.data[0].content).toBe("Partial content");
    });

    it("should handle WAITING_FOR_TOOLS state", async () => {
      await testDb
        .update(prompts)
        .set({ state: "WAITING_FOR_TOOLS" })
        .where(eq(prompts.id, promptId));

      // Create completed tool calls
      const [block] = await testDb
        .insert(blocks)
        .values({
          promptId,
          type: "tool_call",
          indexNum: 0,
          content: "",
        })
        .returning();

      await testDb.insert(toolCalls).values({
        promptId,
        blockId: block.id,
        toolName: "test_tool",
        state: "complete",
        request: {},
        response: { result: "success" },
      });

      const result = await stateMachine.resume();
      expect(result.status).toBe("continue_with_tools");
      expect(result.data).toHaveLength(1);

      // Check prompt state was updated
      const [prompt] = await testDb
        .select()
        .from(prompts)
        .where(eq(prompts.id, promptId));

      expect(prompt.state).toBe("IN_PROGRESS");
    });
  });

  describe("handleError", () => {
    it("should update prompt state to ERROR", async () => {
      await stateMachine.handleError("Something went wrong");

      const [prompt] = await testDb
        .select()
        .from(prompts)
        .where(eq(prompts.id, promptId));

      expect(prompt.state).toBe("ERROR");
      expect(prompt.error).toBe("Something went wrong");
    });
  });
});
