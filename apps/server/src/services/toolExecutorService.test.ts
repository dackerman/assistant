import { beforeAll, afterAll, describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ChildProcess } from "child_process";
import { setupTestDatabase, teardownTestDatabase, testDb } from "../test/setup";
import { ToolExecutorService } from "./toolExecutorService";
import { toolCalls, prompts, blocks, users, conversations, messages } from "../db/schema";

// Mock child_process
const mockSpawn = vi.fn();
vi.mock("child_process", () => ({
  spawn: mockSpawn,
}));

// Mock process.kill for process checking
const originalKill = process.kill;
const mockKill = vi.fn();

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

describe("ToolExecutorService", () => {
  let service: ToolExecutorService;
  let testData: {
    userId: number;
    conversationId: number;
    messageId: number;
    promptId: number;
    blockId: number;
    toolCallId: number;
  };

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    stubClock();
    
    // Replace process.kill for process checking
    Object.defineProperty(process, 'kill', {
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

    const [toolCall] = await testDb.insert(toolCalls).values({
      promptId: prompt.id,
      blockId: block.id,
      toolName: "Bash",
      state: "created",
      request: { command: "echo 'test'" },
    }).returning();

    testData = {
      userId: user.id,
      conversationId: conversation.id,
      messageId: message.id,
      promptId: prompt.id,
      blockId: block.id,
      toolCallId: toolCall.id,
    };

    vi.clearAllMocks();
    mockKill.mockImplementation((pid: number, signal: string | number) => {
      if (signal === 0) {
        // Mock process existence check - return true for our test PIDs
        return true;
      }
      return originalKill(pid, signal);
    });
  });

  afterEach(async () => {
    restoreClock();
    
    // Restore original process.kill
    Object.defineProperty(process, 'kill', {
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
      await service.gracefulShutdown?.();
    }
  });

  describe("Basic execution", () => {
    test("should execute tool call successfully", async () => {
      // Mock successful process
      const mockProcess = {
        pid: 12345,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      } as any;

      mockSpawn.mockReturnValue(mockProcess);

      // Start execution
      const executePromise = service.executeToolCall(testData.toolCallId);

      // Simulate process events
      setTimeout(() => {
        const stdoutHandler = mockProcess.stdout.on.mock.calls.find(
          (call: any) => call[0] === "data"
        )?.[1];
        
        if (stdoutHandler) {
          stdoutHandler("test output");
        }

        const closeHandler = mockProcess.on.mock.calls.find(
          (call: any) => call[0] === "close"
        )?.[1];
        
        if (closeHandler) {
          closeHandler(0); // Success exit code
        }
      }, 100);

      await executePromise;

      // Verify database state
      const updatedToolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId),
      });

      expect(updatedToolCall).toMatchObject({
        state: "complete",
        pid: 12345,
      });
      expect(updatedToolCall?.response).toMatchObject({
        output: "test output",
        exitCode: 0,
      });
      expect(updatedToolCall?.startedAt).toBeInstanceOf(Date);
      expect(mockSpawn).toHaveBeenCalledWith("bash", ["-c", "echo 'test'"], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });
    });

    test("should handle process failure", async () => {
      const mockProcess = {
        pid: 12345,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      } as any;

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = service.executeToolCall(testData.toolCallId);

      setTimeout(() => {
        const stderrHandler = mockProcess.stderr.on.mock.calls.find(
          (call: any) => call[0] === "data"
        )?.[1];
        
        if (stderrHandler) {
          stderrHandler("error output");
        }

        const closeHandler = mockProcess.on.mock.calls.find(
          (call: any) => call[0] === "close"
        )?.[1];
        
        if (closeHandler) {
          closeHandler(1); // Error exit code
        }
      }, 100);

      await expect(executePromise).rejects.toThrow("Process exited with code 1");

      const updatedToolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId),
      });

      expect(updatedToolCall?.state).toBe("error");
      expect(updatedToolCall?.error).toContain("Process exited with code 1");
    });

    test("should handle process timeout", async () => {
      const mockProcess = {
        pid: 12345,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      } as any;

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = service.executeToolCall(testData.toolCallId);

      // Advance time past timeout (5 seconds + some buffer)
      setTimeout(() => {
        advanceTime(6000);
      }, 100);

      await expect(executePromise).rejects.toThrow("Tool execution timed out");

      expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
      
      const updatedToolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId),
      });

      expect(updatedToolCall?.state).toBe("error");
      expect(updatedToolCall?.error).toContain("timed out");
    });
  });

  describe("Retry logic", () => {
    test("should retry retryable errors", async () => {
      const mockProcess = {
        pid: 12345,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      } as any;

      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        return mockProcess;
      });

      const executePromise = service.executeToolCall(testData.toolCallId);

      // First attempt fails with retryable error
      setTimeout(() => {
        const errorHandler = mockProcess.on.mock.calls.find(
          (call: any) => call[0] === "error"
        )?.[1];
        
        if (errorHandler && callCount === 1) {
          errorHandler(new Error("ECONNRESET: Connection reset"));
        }
      }, 50);

      // Second attempt succeeds
      setTimeout(() => {
        if (callCount === 2) {
          const closeHandler = mockProcess.on.mock.calls.find(
            (call: any) => call[0] === "close"
          )?.[1];
          
          if (closeHandler) {
            closeHandler(0);
          }
        }
      }, 150);

      await executePromise;

      // Should have been called twice (initial + 1 retry)
      expect(mockSpawn).toHaveBeenCalledTimes(2);
      
      const updatedToolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId),
      });

      expect(updatedToolCall?.state).toBe("complete");
      expect(updatedToolCall?.retryCount).toBe(1);
    });

    test("should not retry non-retryable errors", async () => {
      const mockProcess = {
        pid: 12345,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      } as any;

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = service.executeToolCall(testData.toolCallId);

      setTimeout(() => {
        const errorHandler = mockProcess.on.mock.calls.find(
          (call: any) => call[0] === "error"
        )?.[1];
        
        if (errorHandler) {
          errorHandler(new Error("Permission denied"));
        }
      }, 50);

      await expect(executePromise).rejects.toThrow("Permission denied");

      // Should only have been called once
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    test("should give up after max retries", async () => {
      const mockProcess = {
        pid: 12345,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      } as any;

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = service.executeToolCall(testData.toolCallId);

      // Make all attempts fail with retryable error
      let attempts = 0;
      const simulateFailure = () => {
        attempts++;
        setTimeout(() => {
          const errorHandler = mockProcess.on.mock.calls.find(
            (call: any) => call[0] === "error"
          )?.[1];
          
          if (errorHandler) {
            errorHandler(new Error("ETIMEDOUT: Connection timed out"));
          }

          if (attempts <= 2) {
            simulateFailure(); // Simulate next attempt
          }
        }, 50 * attempts);
      };

      simulateFailure();

      await expect(executePromise).rejects.toThrow("ETIMEDOUT");

      // Should have been called 3 times (initial + 2 retries)
      expect(mockSpawn).toHaveBeenCalledTimes(3);

      const updatedToolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId),
      });

      expect(updatedToolCall?.retryCount).toBe(2);
    });
  });

  describe("Recovery mechanisms", () => {
    test("should cleanup orphaned processes on startup", async () => {
      // Create a running tool call with PID
      await testDb.update(toolCalls)
        .set({
          state: "running",
          pid: 99999,
          startedAt: new Date(),
        })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId));

      // Mock process check to return false (process doesn't exist)
      mockKill.mockImplementation((pid: number, signal: string | number) => {
        if (signal === 0 && pid === 99999) {
          throw new Error("ESRCH: No such process");
        }
        return true;
      });

      await service.initialize();

      const updatedToolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId),
      });

      expect(updatedToolCall?.state).toBe("error");
      expect(updatedToolCall?.error).toContain("orphaned on startup");
    });

    test("should detect stale processes during periodic check", async () => {
      await service.initialize();

      // Create a running tool call that's gone stale
      const staleTime = new Date(currentTime.getTime() - 10000); // 10 seconds ago
      await testDb.update(toolCalls)
        .set({
          state: "running",
          pid: 88888,
          startedAt: staleTime,
          lastHeartbeat: staleTime,
        })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId));

      // Mock process check to return false (process doesn't exist)
      mockKill.mockImplementation((pid: number, signal: string | number) => {
        if (signal === 0 && pid === 88888) {
          throw new Error("ESRCH: No such process");
        }
        return true;
      });

      // Advance time to trigger stale check
      advanceTime(3000);

      // Wait for stale check to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const updatedToolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId),
      });

      expect(updatedToolCall?.state).toBe("error");
      expect(updatedToolCall?.error).toContain("detected as stale");
    });

    test("should handle graceful shutdown", async () => {
      const mockProcess = {
        pid: 77777,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      } as any;

      mockSpawn.mockReturnValue(mockProcess);

      // Start a tool execution
      const executePromise = service.executeToolCall(testData.toolCallId);

      // Let it start
      await new Promise(resolve => setTimeout(resolve, 50));

      // Initiate shutdown
      const shutdownPromise = service.gracefulShutdown();

      // Simulate process termination
      setTimeout(() => {
        mockProcess.killed = true;
        const closeHandler = mockProcess.on.mock.calls.find(
          (call: any) => call[0] === "close"
        )?.[1];
        
        if (closeHandler) {
          closeHandler(130); // SIGTERM exit code
        }
      }, 200);

      await Promise.all([
        expect(executePromise).rejects.toThrow(),
        shutdownPromise
      ]);

      expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");

      const updatedToolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId),
      });

      expect(updatedToolCall?.state).toBe("canceled");
      expect(updatedToolCall?.error).toContain("service shutdown");
    });
  });

  describe("Cancellation", () => {
    test("should cancel running execution", async () => {
      const mockProcess = {
        pid: 66666,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      } as any;

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = service.executeToolCall(testData.toolCallId);

      // Let it start
      await new Promise(resolve => setTimeout(resolve, 50));

      // Cancel execution
      await service.cancelExecution(testData.toolCallId);

      expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");

      const updatedToolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId),
      });

      expect(updatedToolCall?.state).toBe("canceled");
      expect(updatedToolCall?.error).toContain("canceled by user");
    });
  });

  describe("Status monitoring", () => {
    test("should provide execution status", async () => {
      // Update tool call to running state
      const startTime = new Date();
      await testDb.update(toolCalls)
        .set({
          state: "running",
          startedAt: startTime,
          lastHeartbeat: startTime,
          outputStream: "partial output",
          retryCount: 1,
        })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId));

      const status = await service.getExecutionStatus(testData.toolCallId);

      expect(status).toMatchObject({
        state: "running",
        startedAt: startTime,
        lastHeartbeat: startTime,
        outputStream: "partial output",
        retryCount: 1,
      });
    });

    test("should return null for non-existent tool call", async () => {
      const status = await service.getExecutionStatus(99999);
      expect(status).toBeNull();
    });
  });

  describe("Edge cases", () => {
    test("should handle tool call not found", async () => {
      await expect(service.executeToolCall(99999))
        .rejects.toThrow("Tool call 99999 not found");
    });

    test("should handle tool call not in created state", async () => {
      await testDb.update(toolCalls)
        .set({ state: "complete" })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId));

      await expect(service.executeToolCall(testData.toolCallId))
        .rejects.toThrow("is not in created state");
    });

    test("should handle unsupported tool", async () => {
      await testDb.update(toolCalls)
        .set({ toolName: "UnsupportedTool" })
        .where((tc, { eq }) => eq(tc.id, testData.toolCallId));

      await expect(service.executeToolCall(testData.toolCallId))
        .rejects.toThrow("Unsupported tool: UnsupportedTool");
    });

    test("should prevent execution during shutdown", async () => {
      // Mark service as shutting down
      (service as any).isShuttingDown = true;

      await expect(service.executeToolCall(testData.toolCallId))
        .rejects.toThrow("Service is shutting down");
    });
  });

  describe("Heartbeat and output streaming", () => {
    test("should update heartbeat and output stream", async () => {
      const mockProcess = {
        pid: 55555,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      } as any;

      mockSpawn.mockReturnValue(mockProcess);

      const executePromise = service.executeToolCall(testData.toolCallId);

      // Simulate streaming output
      setTimeout(() => {
        const stdoutHandler = mockProcess.stdout.on.mock.calls.find(
          (call: any) => call[0] === "data"
        )?.[1];
        
        if (stdoutHandler) {
          stdoutHandler("chunk 1\n");
        }
      }, 50);

      setTimeout(() => {
        const stdoutHandler = mockProcess.stdout.on.mock.calls.find(
          (call: any) => call[0] === "data"
        )?.[1];
        
        if (stdoutHandler) {
          stdoutHandler("chunk 2\n");
        }

        const closeHandler = mockProcess.on.mock.calls.find(
          (call: any) => call[0] === "close"
        )?.[1];
        
        if (closeHandler) {
          closeHandler(0);
        }
      }, 100);

      await executePromise;

      const finalToolCall = await testDb.query.toolCalls.findFirst({
        where: (tc, { eq }) => eq(tc.id, testData.toolCallId),
      });

      expect(finalToolCall?.outputStream).toBe("chunk 1\nchunk 2\n");
      expect(finalToolCall?.lastHeartbeat).toBeInstanceOf(Date);
    });
  });
});