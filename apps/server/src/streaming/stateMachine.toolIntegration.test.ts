import { beforeAll, afterAll, describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTestDatabase, teardownTestDatabase, testDb } from "../test/setup";
import { StreamingStateMachine } from "./stateMachine";
import { ToolExecutorService } from "../services/toolExecutorService";
import { 
  toolCalls, 
  prompts, 
  blocks, 
  users, 
  conversations, 
  messages 
} from "../db/schema";

// Mock ToolExecutorService
const mockExecuteToolCall = vi.fn();
const mockCancelExecution = vi.fn();
const mockCheckToolCompletion = vi.fn();

class MockToolExecutor extends ToolExecutorService {
  async executeToolCall(id: number) {
    return mockExecuteToolCall(id);
  }

  async cancelExecution(id: number) {
    return mockCancelExecution(id);
  }
}

// Clock utilities
let clockStub: any;
let currentTime = new Date("2024-01-15T10:00:00Z");

function stubClock() {
  clockStub = vi.fn(() => currentTime.getTime());
  vi.stubGlobal("Date", class extends Date {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super(currentTime);
      } else {
        super(...args);
      }
    }
    
    static now() {
      return clockStub();
    }
  });
}

function advanceTime(ms: number) {
  currentTime = new Date(currentTime.getTime() + ms);
}

function restoreClock() {
  vi.unstubAllGlobals();
}

describe("StateMachine Tool Integration", () => {
  let stateMachine: StreamingStateMachine;
  let mockToolExecutor: MockToolExecutor;
  let testData: {
    userId: number;
    conversationId: number;
    messageId: number;
    promptId: number;
    blockId: number;
    toolCallId1: number;
    toolCallId2: number;
  };

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    stubClock();

    // Create test data
    const [user] = await testDb.insert(users).values({
      email: "test@example.com",
    }).returning();

    const [conversation] = await testDb.insert(conversations).values({
      userId: user.id,
      title: "Test Conversation",
    }).returning();

    const [message] = await testDb.insert(messages).values({
      conversationId: conversation.id,
      role: "assistant",
    }).returning();

    const [prompt] = await testDb.insert(prompts).values({
      conversationId: conversation.id,
      messageId: message.id,
      state: "IN_PROGRESS",
      model: "claude-3",
    }).returning();

    const [block] = await testDb.insert(blocks).values({
      promptId: prompt.id,
      type: "tool_call",
      indexNum: 0,
      content: "test content",
    }).returning();

    // Create two tool calls for testing
    const [toolCall1] = await testDb.insert(toolCalls).values({
      promptId: prompt.id,
      blockId: block.id,
      toolName: "Bash",
      state: "created",
      request: { command: "echo 'test1'" },
    }).returning();

    const [toolCall2] = await testDb.insert(toolCalls).values({
      promptId: prompt.id,
      blockId: block.id,
      toolName: "Bash",
      state: "created",
      request: { command: "echo 'test2'" },
    }).returning();

    testData = {
      userId: user.id,
      conversationId: conversation.id,
      messageId: message.id,
      promptId: prompt.id,
      blockId: block.id,
      toolCallId1: toolCall1.id,
      toolCallId2: toolCall2.id,
    };

    mockToolExecutor = new MockToolExecutor();
    stateMachine = new StreamingStateMachine(
      testData.promptId,
      testDb,
      mockToolExecutor
    );

    vi.clearAllMocks();
  });

  afterEach(async () => {
    restoreClock();

    // Clean up test data
    await testDb.delete(toolCalls);
    await testDb.delete(blocks);
    await testDb.delete(prompts);
    await testDb.delete(messages);
    await testDb.delete(conversations);
    await testDb.delete(users);
  });

  describe("Tool execution on message stop", () => {
    test("should execute tool calls when stopping with pending tools", async () => {
      mockExecuteToolCall.mockResolvedValue(undefined);

      await stateMachine.handleMessageStop();

      // Should have executed both tool calls
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(2);
      expect(mockExecuteToolCall).toHaveBeenCalledWith(testData.toolCallId1);
      expect(mockExecuteToolCall).toHaveBeenCalledWith(testData.toolCallId2);

      // Should transition to WAITING_FOR_TOOLS
      const updatedPrompt = await testDb.query.prompts.findFirst({
        where: (p, { eq }) => eq(p.id, testData.promptId),
      });

      expect(updatedPrompt?.state).toBe("WAITING_FOR_TOOLS");
    });

    test("should complete immediately if no pending tools", async () => {
      // Mark tool calls as complete
      await testDb.update(toolCalls)
        .set({ state: "complete" })
        .where((tc, { inArray }) => inArray(tc.id, [testData.toolCallId1, testData.toolCallId2]));

      await stateMachine.handleMessageStop();

      // Should not execute any tools
      expect(mockExecuteToolCall).not.toHaveBeenCalled();

      // Should complete the prompt
      const updatedPrompt = await testDb.query.prompts.findFirst({
        where: (p, { eq }) => eq(p.id, testData.promptId),
      });

      expect(updatedPrompt?.state).toBe("COMPLETED");
    });

    test("should handle tool execution failures gracefully", async () => {
      mockExecuteToolCall
        .mockResolvedValueOnce(undefined) // First tool succeeds
        .mockRejectedValueOnce(new Error("Execution failed")); // Second tool fails

      await stateMachine.handleMessageStop();

      expect(mockExecuteToolCall).toHaveBeenCalledTimes(2);

      // Should still transition to WAITING_FOR_TOOLS even if some tools fail
      const updatedPrompt = await testDb.query.prompts.findFirst({
        where: (p, { eq }) => eq(p.id, testData.promptId),
      });

      expect(updatedPrompt?.state).toBe("WAITING_FOR_TOOLS");
    });

    test("should warn when no tool executor available", async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Create state machine without tool executor
      const stateMachineNoExecutor = new StreamingStateMachine(
        testData.promptId,
        testDb
      );

      await stateMachineNoExecutor.handleMessageStop();

      expect(mockExecuteToolCall).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe("Tool completion checking", () => {
    test("should check tool completion status correctly", async () => {
      // Set up mixed completion states
      await testDb.update(toolCalls)
        .set({ state: "complete" })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId1));
      // Leave toolCallId2 as "created"

      const result = await stateMachine.checkToolCompletion();

      expect(result.allComplete).toBe(false);
      expect(result.completedTools).toHaveLength(1);
      expect(result.pendingTools).toHaveLength(1);
      expect(result.completedTools[0].id).toBe(testData.toolCallId1);
      expect(result.pendingTools[0].id).toBe(testData.toolCallId2);
    });

    test("should report all complete when all tools are done", async () => {
      await testDb.update(toolCalls)
        .set({ state: "complete" })
        .where((tc, { inArray }) => inArray(tc.id, [testData.toolCallId1, testData.toolCallId2]));

      const result = await stateMachine.checkToolCompletion();

      expect(result.allComplete).toBe(true);
      expect(result.completedTools).toHaveLength(2);
      expect(result.pendingTools).toHaveLength(0);
    });

    test("should consider error and canceled states as complete", async () => {
      await testDb.update(toolCalls)
        .set({ state: "error" })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId1));

      await testDb.update(toolCalls)
        .set({ state: "canceled" })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId2));

      const result = await stateMachine.checkToolCompletion();

      expect(result.allComplete).toBe(true);
      expect(result.completedTools).toHaveLength(2);
      expect(result.pendingTools).toHaveLength(0);
    });
  });

  describe("Continue after tools", () => {
    test("should continue execution when all tools are complete", async () => {
      // Set tools as complete with responses
      await testDb.update(toolCalls)
        .set({
          state: "complete",
          response: { output: "test output 1", exitCode: 0 }
        })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId1));

      await testDb.update(toolCalls)
        .set({
          state: "error",
          error: "test error"
        })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId2));

      const result = await stateMachine.continueAfterTools();

      expect(result.status).toBe("ready");
      expect(result.toolResults).toHaveLength(2);

      // Check successful tool result
      const successResult = result.toolResults.find(r => r.state === "complete");
      expect(successResult).toMatchObject({
        toolName: "Bash",
        state: "complete",
        response: { output: "test output 1", exitCode: 0 }
      });

      // Check error tool result
      const errorResult = result.toolResults.find(r => r.state === "error");
      expect(errorResult).toMatchObject({
        toolName: "Bash",
        state: "error",
        error: "test error"
      });

      // Should transition back to IN_PROGRESS
      const updatedPrompt = await testDb.query.prompts.findFirst({
        where: (p, { eq }) => eq(p.id, testData.promptId),
      });

      expect(updatedPrompt?.state).toBe("IN_PROGRESS");
    });

    test("should return still_waiting when tools are not complete", async () => {
      // Leave one tool as "running"
      await testDb.update(toolCalls)
        .set({ state: "complete" })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId1));

      await testDb.update(toolCalls)
        .set({ state: "running" })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId2));

      const result = await stateMachine.continueAfterTools();

      expect(result.status).toBe("still_waiting");
      expect(result.toolResults).toHaveLength(0);

      // Should not change prompt state
      const updatedPrompt = await testDb.query.prompts.findFirst({
        where: (p, { eq }) => eq(p.id, testData.promptId),
      });

      expect(updatedPrompt?.state).toBe("IN_PROGRESS"); // Still original state
    });
  });

  describe("Cancellation with tool executor", () => {
    test("should cancel running tool executions", async () => {
      // Set tools as running
      await testDb.update(toolCalls)
        .set({ 
          state: "running",
          pid: 12345
        })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId1));

      await testDb.update(toolCalls)
        .set({ 
          state: "created"
        })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId2));

      mockCancelExecution.mockResolvedValue(undefined);

      await stateMachine.cancel();

      // Should cancel running tool executions
      expect(mockCancelExecution).toHaveBeenCalledTimes(2);
      expect(mockCancelExecution).toHaveBeenCalledWith(testData.toolCallId1);
      expect(mockCancelExecution).toHaveBeenCalledWith(testData.toolCallId2);

      // Should update prompt state
      const updatedPrompt = await testDb.query.prompts.findFirst({
        where: (p, { eq }) => eq(p.id, testData.promptId),
      });

      expect(updatedPrompt?.state).toBe("CANCELED");

      // Should update tool call states
      const updatedTools = await testDb.query.toolCalls.findMany({
        where: (tc, { eq }) => eq(tc.promptId, testData.promptId),
      });

      expect(updatedTools.every(t => t.state === "canceled")).toBe(true);
    });

    test("should handle cancellation errors gracefully", async () => {
      await testDb.update(toolCalls)
        .set({ state: "running" })
        .where((tc, { inArray }) => inArray(tc.id, [testData.toolCallId1, testData.toolCallId2]));

      mockCancelExecution
        .mockResolvedValueOnce(undefined) // First succeeds
        .mockRejectedValueOnce(new Error("Cancel failed")); // Second fails

      // Should not throw despite cancellation error
      await expect(stateMachine.cancel()).resolves.not.toThrow();

      expect(mockCancelExecution).toHaveBeenCalledTimes(2);

      // Should still update database states
      const updatedTools = await testDb.query.toolCalls.findMany({
        where: (tc, { eq }) => eq(tc.promptId, testData.promptId),
      });

      expect(updatedTools.every(t => t.state === "canceled")).toBe(true);
    });
  });

  describe("Resume with tool integration", () => {
    test("should resume WAITING_FOR_TOOLS state with completed tools", async () => {
      // Set prompt to WAITING_FOR_TOOLS
      await testDb.update(prompts)
        .set({ state: "WAITING_FOR_TOOLS" })
        .where((p, { eq }) => eq(p.id, testData.promptId));

      // Complete both tools
      await testDb.update(toolCalls)
        .set({
          state: "complete",
          response: { output: "output1", exitCode: 0 }
        })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId1));

      await testDb.update(toolCalls)
        .set({
          state: "complete",
          response: { output: "output2", exitCode: 0 }
        })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId2));

      const result = await stateMachine.resume();

      expect(result.status).toBe("continue_with_tools");
      expect(result.data).toHaveLength(2);
      expect(result.data.every((t: any) => t.state === "complete")).toBe(true);

      // Should have transitioned to IN_PROGRESS
      const updatedPrompt = await testDb.query.prompts.findFirst({
        where: (p, { eq }) => eq(p.id, testData.promptId),
      });

      expect(updatedPrompt?.state).toBe("IN_PROGRESS");
    });

    test("should resume WAITING_FOR_TOOLS state with pending tools", async () => {
      // Set prompt to WAITING_FOR_TOOLS
      await testDb.update(prompts)
        .set({ state: "WAITING_FOR_TOOLS" })
        .where((p, { eq }) => eq(p.id, testData.promptId));

      // Complete one tool, leave one running
      await testDb.update(toolCalls)
        .set({ state: "complete" })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId1));

      await testDb.update(toolCalls)
        .set({ state: "running" })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId2));

      const result = await stateMachine.resume();

      expect(result.status).toBe("waiting_for_tools");
      expect(result.data.completedTools).toHaveLength(1);
      expect(result.data.pendingTools).toHaveLength(1);
      expect(result.data.totalTools).toBe(2);
    });
  });

  describe("Error handling", () => {
    test("should handle database errors during tool operations", async () => {
      // Mock database error
      const mockDb = {
        ...testDb,
        select: vi.fn().mockRejectedValue(new Error("Database connection lost"))
      };

      const errorStateMachine = new StreamingStateMachine(
        testData.promptId,
        mockDb,
        mockToolExecutor
      );

      await expect(errorStateMachine.checkToolCompletion())
        .rejects.toThrow("Database connection lost");
    });
  });

  describe("Performance", () => {
    test("should handle large number of tool calls efficiently", async () => {
      const startTime = Date.now();

      // Create 50 tool calls
      const toolCallPromises = Array.from({ length: 50 }, (_, i) =>
        testDb.insert(toolCalls).values({
          promptId: testData.promptId,
          blockId: testData.blockId,
          toolName: "Bash",
          state: "complete",
          request: { command: `echo 'test${i}'` },
          response: { output: `output${i}`, exitCode: 0 }
        })
      );

      await Promise.all(toolCallPromises);

      const result = await stateMachine.continueAfterTools();

      const duration = Date.now() - startTime;

      expect(result.status).toBe("ready");
      expect(result.toolResults).toHaveLength(52); // 50 + original 2
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});