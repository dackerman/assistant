import { vi } from "vitest";

// Mock child_process - must be at the top
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { and, desc, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  blocks,
  conversations,
  messages,
  prompts,
  toolCalls,
  users,
} from "../db/schema";
import { setupTestDatabase, teardownTestDatabase, testDb } from "../test/setup";
import { ToolExecutorService } from "./toolExecutorService";

// Mock process.kill for process checking
const originalKill = process.kill;
const mockKill = vi.fn();

// Clock utilities
let clockStub: any;
let currentTime = new Date("2024-01-15T10:00:00Z");
let originalDate: DateConstructor;

function stubClock() {
  clockStub = vi.fn(() => currentTime.getTime());
  originalDate = globalThis.Date;

  globalThis.Date = class extends Date {
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
  } as any;
}

function advanceTime(ms: number) {
  currentTime = new Date(currentTime.getTime() + ms);
}

function restoreClock() {
  if (originalDate) {
    globalThis.Date = originalDate;
  }
}

describe("ToolExecutorService Database Integration Tests", () => {
  let service: ToolExecutorService;
  let mockSpawn: any;
  let testData: {
    userId: number;
    conversationId1: number;
    conversationId2: number;
    messageId1: number;
    messageId2: number;
    promptId1: number;
    promptId2: number;
    blockId1: number;
    blockId2: number;
    toolCallId1: number;
    toolCallId2: number;
    toolCallId3: number;
  };

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    stubClock();

    // Get the mock spawn function
    const childProcessMock =
      await vi.importMock<typeof import("child_process")>("child_process");
    mockSpawn = childProcessMock.spawn;

    // Replace process.kill for process checking
    Object.defineProperty(process, "kill", {
      value: mockKill,
      writable: true,
      configurable: true,
    });

    service = new ToolExecutorService({
      maxRetries: 2,
      timeoutSeconds: 5,
      heartbeatInterval: 1000,
      staleCheckInterval: 2000,
      shutdownGracePeriod: 1000,
    });

    await service.initialize();

    // Create comprehensive test data
    const [user] = await testDb
      .insert(users)
      .values({
        email: "test@example.com",
      })
      .returning();

    const [conversation1] = await testDb
      .insert(conversations)
      .values({
        userId: user.id,
        title: "Test Conversation 1",
      })
      .returning();

    const [conversation2] = await testDb
      .insert(conversations)
      .values({
        userId: user.id,
        title: "Test Conversation 2",
      })
      .returning();

    const [message1] = await testDb
      .insert(messages)
      .values({
        conversationId: conversation1.id,
        role: "assistant",
      })
      .returning();

    const [message2] = await testDb
      .insert(messages)
      .values({
        conversationId: conversation2.id,
        role: "assistant",
      })
      .returning();

    const [prompt1] = await testDb
      .insert(prompts)
      .values({
        conversationId: conversation1.id,
        messageId: message1.id,
        state: "IN_PROGRESS",
        model: "claude-3",
      })
      .returning();

    const [prompt2] = await testDb
      .insert(prompts)
      .values({
        conversationId: conversation2.id,
        messageId: message2.id,
        state: "IN_PROGRESS",
        model: "claude-3",
      })
      .returning();

    const [block1] = await testDb
      .insert(blocks)
      .values({
        promptId: prompt1.id,
        type: "tool_call",
        indexNum: 0,
        content: "test content",
      })
      .returning();

    const [block2] = await testDb
      .insert(blocks)
      .values({
        promptId: prompt2.id,
        type: "tool_call",
        indexNum: 0,
        content: "test content",
      })
      .returning();

    // Create tool calls for testing
    const [toolCall1] = await testDb
      .insert(toolCalls)
      .values({
        promptId: prompt1.id,
        blockId: block1.id,
        toolName: "bash",
        state: "created",
        request: { command: "echo 'test1'" },
      })
      .returning();

    const [toolCall2] = await testDb
      .insert(toolCalls)
      .values({
        promptId: prompt1.id,
        blockId: block1.id,
        toolName: "bash",
        state: "created",
        request: { command: "echo 'test2'" },
      })
      .returning();

    const [toolCall3] = await testDb
      .insert(toolCalls)
      .values({
        promptId: prompt2.id,
        blockId: block2.id,
        toolName: "bash",
        state: "created",
        request: { command: "echo 'test3'" },
      })
      .returning();

    testData = {
      userId: user.id,
      conversationId1: conversation1.id,
      conversationId2: conversation2.id,
      messageId1: message1.id,
      messageId2: message2.id,
      promptId1: prompt1.id,
      promptId2: prompt2.id,
      blockId1: block1.id,
      blockId2: block2.id,
      toolCallId1: toolCall1.id,
      toolCallId2: toolCall2.id,
      toolCallId3: toolCall3.id,
    };

    vi.clearAllMocks();
    mockKill.mockImplementation((pid: number, signal: string | number) => {
      if (signal === 0) {
        return true; // Mock process exists
      }
      return originalKill(pid, signal);
    });
  });

  afterEach(async () => {
    restoreClock();

    // Restore original process.kill
    Object.defineProperty(process, "kill", {
      value: originalKill,
      writable: true,
      configurable: true,
    });

    // Clean up test data
    await testDb.delete(toolCalls);
    await testDb.delete(blocks);
    await testDb.delete(prompts);
    await testDb.delete(messages);
    await testDb.delete(conversations);
    await testDb.delete(users);

    if (service) {
      await (service as any).gracefulShutdown();
    }
  });

  describe("Session-Based Execution", () => {
    test("should execute tool calls in same session for same conversation", async () => {
      const mockProcess = createMockProcess();
      const { spawn } =
        await vi.importMock<typeof import("child_process")>("child_process");
      (spawn as any).mockReturnValue(mockProcess);

      // Execute two tool calls from same conversation
      const executePromise1 = service.executeToolCall(testData.toolCallId1);
      const executePromise2 = service.executeToolCall(testData.toolCallId2);

      // Let them start
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate successful completion for both
      simulateCommandCompletion(mockProcess, "output1");
      await new Promise((resolve) => setTimeout(resolve, 50));
      simulateCommandCompletion(mockProcess, "output2");

      await Promise.all([executePromise1, executePromise2]);

      // Verify both tool calls completed
      const toolCall1 = await testDb.query.toolCalls.findFirst({
        where: eq(toolCalls.id, testData.toolCallId1),
      });
      const toolCall2 = await testDb.query.toolCalls.findFirst({
        where: eq(toolCalls.id, testData.toolCallId2),
      });

      expect(toolCall1?.state).toBe("complete");
      expect(toolCall2?.state).toBe("complete");
      expect((toolCall1?.response as any)?.output).toBe("output1");
      expect((toolCall2?.response as any)?.output).toBe("output2");

      // Should use same process (same session)
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    test("should use separate sessions for different conversations", async () => {
      const mockProcess1 = createMockProcess(12345);
      const mockProcess2 = createMockProcess(12346);

      const { spawn } =
        await vi.importMock<typeof import("child_process")>("child_process");
      (spawn as any)
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);

      // Execute tool calls from different conversations
      const executePromise1 = service.executeToolCall(testData.toolCallId1);
      const executePromise3 = service.executeToolCall(testData.toolCallId3);

      // Let them start
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate completion
      simulateCommandCompletion(mockProcess1, "output1");
      simulateCommandCompletion(mockProcess2, "output3");

      await Promise.all([executePromise1, executePromise3]);

      // Should create separate processes (different sessions)
      expect(mockSpawn).toHaveBeenCalledTimes(2);

      const toolCall1 = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId1),
      });
      const toolCall3 = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId3),
      });

      expect(toolCall1?.state).toBe("complete");
      expect(toolCall3?.state).toBe("complete");
    });

    test("should maintain sequential execution within session", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const executionOrder: number[] = [];
      const originalWrite = mockProcess.stdin!.write;
      mockProcess.stdin!.write = vi.fn((data: any) => {
        const command = data.toString();
        if (command.includes("test1")) executionOrder.push(1);
        if (command.includes("test2")) executionOrder.push(2);
        return originalWrite(data);
      });

      // Start both executions
      const executePromise1 = service.executeToolCall(testData.toolCallId1);
      const executePromise2 = service.executeToolCall(testData.toolCallId2);

      // Let first command start
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Complete first command
      simulateCommandCompletion(mockProcess, "output1");

      // Let second command start
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Complete second command
      simulateCommandCompletion(mockProcess, "output2");

      await Promise.all([executePromise1, executePromise2]);

      // Commands should execute in order
      expect(executionOrder).toEqual([1, 2]);
    });

    test("should handle session restart requests", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Add restart command
      await testDb.insert(toolCalls).values({
        promptId: testData.promptId1,
        blockId: testData.blockId1,
        toolName: "bash",
        state: "created",
        request: { restart: true },
      });

      const restartToolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { and, eq }) =>
          and(eq(tc.promptId, testData.promptId1), eq(tc.state, "created")),
        orderBy: (tc, { desc }) => [desc(tc.id)],
      });

      const executePromise = service.executeToolCall(restartToolCall!.id);

      await new Promise((resolve) => setTimeout(resolve, 50));

      await executePromise;

      const updatedToolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, restartToolCall!.id),
      });

      expect(updatedToolCall?.state).toBe("complete");
      expect((updatedToolCall?.response as any)?.output).toBe(
        "Session restarted successfully",
      );
    });
  });

  describe("Database State Verification", () => {
    test("should correctly update database throughout execution lifecycle", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = service.executeToolCall(testData.toolCallId1);

      // Check initial state change to running
      await new Promise((resolve) => setTimeout(resolve, 50));

      let toolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId1),
      });

      expect(toolCall?.state).toBe("running");
      expect(toolCall?.startedAt).toBeInstanceOf(Date);
      expect(toolCall?.lastHeartbeat).toBeInstanceOf(Date);

      // Complete execution
      simulateCommandCompletion(mockProcess, "test output");
      await executePromise;

      // Check final state
      toolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId1),
      });

      expect(toolCall?.state).toBe("complete");
      expect((toolCall?.response as any)?.output).toBe("test output");
      expect(toolCall?.outputStream).toBe("test output");
    });

    test("should handle execution failures with proper database updates", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = service.executeToolCall(testData.toolCallId1);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate process error
      const errorHandler = mockProcess.on.mock.calls.find(
        (call: any) => call[0] === "error",
      )?.[1];

      if (errorHandler) {
        errorHandler(new Error("Process crashed"));
      }

      await expect(executePromise).rejects.toThrow();

      const toolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId1),
      });

      expect(toolCall?.state).toBe("error");
      expect(toolCall?.error).toContain("Process crashed");
    });

    test("should track conversation isolation in database", async () => {
      const mockProcess1 = createMockProcess(11111);
      const mockProcess2 = createMockProcess(22222);

      const { spawn } =
        await vi.importMock<typeof import("child_process")>("child_process");
      (spawn as any)
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);

      const executePromise1 = service.executeToolCall(testData.toolCallId1);
      const executePromise3 = service.executeToolCall(testData.toolCallId3);

      await new Promise((resolve) => setTimeout(resolve, 50));

      simulateCommandCompletion(mockProcess1, "conv1 output");
      simulateCommandCompletion(mockProcess2, "conv2 output");

      await Promise.all([executePromise1, executePromise3]);

      // Verify separate sessions maintained different state
      const toolCall1 = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId1),
      });
      const toolCall3 = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId3),
      });

      expect((toolCall1?.response as any)?.output).toBe("conv1 output");
      expect((toolCall3?.response as any)?.output).toBe("conv2 output");
    });
  });

  describe("Error Recovery and Edge Cases", () => {
    test("should handle invalid tool call IDs", async () => {
      await expect(service.executeToolCall(99999)).rejects.toThrow(
        "Tool call 99999 not found",
      );
    });

    test("should handle tool calls not in created state", async () => {
      await testDb
        .update(toolCalls)
        .set({ state: "complete" })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId1));

      await expect(
        service.executeToolCall(testData.toolCallId1),
      ).rejects.toThrow("is not in created state");
    });

    test("should handle missing prompt/conversation data", async () => {
      // Delete the prompt
      await testDb
        .delete(prompts)
        .where((p, { eq }) => eq(p.id, testData.promptId1));

      await expect(
        service.executeToolCall(testData.toolCallId1),
      ).rejects.toThrow("not found");
    });

    test("should handle session creation failures", async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error("Failed to create process");
      });

      await expect(
        service.executeToolCall(testData.toolCallId1),
      ).rejects.toThrow();

      const toolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId1),
      });

      expect(toolCall?.state).toBe("error");
    });
  });

  describe("Concurrent Access", () => {
    test("should handle multiple concurrent executions safely", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Create additional tool calls for testing concurrency
      const additionalCalls = await Promise.all([
        testDb
          .insert(toolCalls)
          .values({
            promptId: testData.promptId1,
            blockId: testData.blockId1,
            toolName: "bash",
            state: "created",
            request: { command: "echo 'concurrent1'" },
          })
          .returning(),
        testDb
          .insert(toolCalls)
          .values({
            promptId: testData.promptId1,
            blockId: testData.blockId1,
            toolName: "bash",
            state: "created",
            request: { command: "echo 'concurrent2'" },
          })
          .returning(),
        testDb
          .insert(toolCalls)
          .values({
            promptId: testData.promptId1,
            blockId: testData.blockId1,
            toolName: "bash",
            state: "created",
            request: { command: "echo 'concurrent3'" },
          })
          .returning(),
      ]);

      const toolCallIds = [
        testData.toolCallId1,
        testData.toolCallId2,
        ...additionalCalls.map(([call]) => call.id),
      ];

      // Execute all concurrently
      const executePromises = toolCallIds.map((id) =>
        service.executeToolCall(id),
      );

      // Let them start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Complete them all
      for (let i = 0; i < toolCallIds.length; i++) {
        simulateCommandCompletion(mockProcess, `output${i + 1}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      await Promise.allSettled(executePromises);

      // Verify all completed successfully
      const finalStates = await Promise.all(
        toolCallIds.map(async (id) => {
          const toolCall = await testDb.query.toolCalls.findFirst({
            where: (tc, { eq }) => eq(tc.id, id),
          });
          return toolCall?.state;
        }),
      );

      expect(finalStates.every((state) => state === "complete")).toBe(true);
    });
  });

  // Helper function to create mock process
  function createMockProcess(pid = 12345) {
    return {
      pid,
      stdout: {
        on: vi.fn(),
        removeListener: vi.fn(),
      },
      stderr: {
        on: vi.fn(),
        removeListener: vi.fn(),
      },
      stdin: { write: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      killed: false,
    } as any;
  }

  // Helper function to simulate command completion
  function simulateCommandCompletion(mockProcess: any, output: string) {
    const stdoutHandler = mockProcess.stdout.on.mock.calls.find(
      (call: any) => call[0] === "data",
    )?.[1];

    if (stdoutHandler) {
      stdoutHandler(`${output}\nCOMMAND_COMPLETE_123\n`);
    }
  }
});
