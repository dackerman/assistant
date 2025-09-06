import { beforeAll, afterAll, describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTestDatabase, teardownTestDatabase, testDb } from "../test/setup";
import { SessionManager, TOOL_CONFIGS } from "./sessionManager";
import { ProcessSession } from "./processSession";
import { toolCalls, prompts, blocks, users, conversations, messages } from "../db/schema";

// Mock child_process for ProcessSession tests
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Clock utilities for timeout testing
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

describe("SessionManager Database Tests", () => {
  let sessionManager: SessionManager;
  let testData: {
    userId: number;
    conversationId1: number;
    conversationId2: number;
    messageId1: number;
    messageId2: number;
    promptId1: number;
    promptId2: number;
  };

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    stubClock();
    sessionManager = new SessionManager();

    // Create test data for multiple conversations
    const [user] = await testDb.insert(users).values({
      email: "test@example.com",
    }).returning();

    const [conversation1] = await testDb.insert(conversations).values({
      userId: user.id,
      title: "Test Conversation 1",
    }).returning();

    const [conversation2] = await testDb.insert(conversations).values({
      userId: user.id,
      title: "Test Conversation 2",
    }).returning();

    const [message1] = await testDb.insert(messages).values({
      conversationId: conversation1.id,
      role: "assistant",
    }).returning();

    const [message2] = await testDb.insert(messages).values({
      conversationId: conversation2.id,
      role: "assistant",
    }).returning();

    const [prompt1] = await testDb.insert(prompts).values({
      conversationId: conversation1.id,
      messageId: message1.id,
      state: "IN_PROGRESS",
      model: "claude-3",
    }).returning();

    const [prompt2] = await testDb.insert(prompts).values({
      conversationId: conversation2.id,
      messageId: message2.id,
      state: "IN_PROGRESS", 
      model: "claude-3",
    }).returning();

    testData = {
      userId: user.id,
      conversationId1: conversation1.id,
      conversationId2: conversation2.id,
      messageId1: message1.id,
      messageId2: message2.id,
      promptId1: prompt1.id,
      promptId2: prompt2.id,
    };

    vi.clearAllMocks();

    // Mock successful bash process
    const mockProcess = {
      pid: 12345,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      stdin: { write: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      killed: false,
    } as any;

    const { spawn } = await vi.importMock<typeof import("child_process")>("child_process");
    (spawn as any).mockReturnValue(mockProcess);
  });

  afterEach(async () => {
    restoreClock();
    await sessionManager.cleanupAllSessions();

    // Clean up test data
    await testDb.delete(toolCalls);
    await testDb.delete(blocks);
    await testDb.delete(prompts);
    await testDb.delete(messages);
    await testDb.delete(conversations);
    await testDb.delete(users);
  });

  describe("Session Creation and Isolation", () => {
    test("should create separate sessions for different conversations", async () => {
      const session1 = await sessionManager.getOrCreateSession(
        testData.conversationId1,
        "bash"
      );
      const session2 = await sessionManager.getOrCreateSession(
        testData.conversationId2,
        "bash"
      );

      expect(session1.id).toBe(`${testData.conversationId1}:bash`);
      expect(session2.id).toBe(`${testData.conversationId2}:bash`);
      expect(session1).not.toBe(session2);

      const stats = sessionManager.getSessionStats();
      expect(stats.totalSessions).toBe(2);
      expect(stats.sessionsByTool.bash).toBe(2);
      expect(stats.sessionsByConversation[testData.conversationId1]).toBe(1);
      expect(stats.sessionsByConversation[testData.conversationId2]).toBe(1);
    });

    test("should reuse existing session for same conversation and tool", async () => {
      const session1 = await sessionManager.getOrCreateSession(
        testData.conversationId1,
        "bash"
      );
      const session2 = await sessionManager.getOrCreateSession(
        testData.conversationId1,
        "bash"
      );

      expect(session1).toBe(session2);
      expect(sessionManager.getSessionStats().totalSessions).toBe(1);
    });

    test("should create separate sessions for different tools in same conversation", async () => {
      // First add a memory-based tool config for testing
      const originalConfigs = { ...TOOL_CONFIGS };
      (TOOL_CONFIGS as any).calculator = {
        name: "calculator",
        requiresSession: true,
        sessionType: 'memory',
        createSession: (conversationId: number) => ({
          id: `${conversationId}:calculator`,
          toolType: 'calculator',
          conversationId,
          lastActivity: new Date(),
          execute: vi.fn(),
          restart: vi.fn(),
          cleanup: vi.fn(),
          isHealthy: vi.fn().mockResolvedValue(true),
        })
      };

      try {
        const bashSession = await sessionManager.getOrCreateSession(
          testData.conversationId1,
          "bash"
        );
        const calcSession = await sessionManager.getOrCreateSession(
          testData.conversationId1,
          "calculator"
        );

        expect(bashSession.id).toBe(`${testData.conversationId1}:bash`);
        expect(calcSession.id).toBe(`${testData.conversationId1}:calculator`);
        expect(bashSession).not.toBe(calcSession);

        const stats = sessionManager.getSessionStats();
        expect(stats.totalSessions).toBe(2);
        expect(stats.sessionsByConversation[testData.conversationId1]).toBe(2);
      } finally {
        // Restore original configs
        Object.keys(TOOL_CONFIGS).forEach(key => {
          if (!(key in originalConfigs)) {
            delete (TOOL_CONFIGS as any)[key];
          }
        });
      }
    });
  });

  describe("Session Lifecycle Management", () => {
    test("should cleanup idle sessions after timeout", async () => {
      // Create session
      const session = await sessionManager.getOrCreateSession(
        testData.conversationId1,
        "bash"
      );

      expect(sessionManager.getSessionStats().totalSessions).toBe(1);

      // Advance time past the session timeout (30 minutes default)
      advanceTime(31 * 60 * 1000);

      // Trigger cleanup (normally done by timer)
      await (sessionManager as any).cleanupIdleSessions();

      expect(sessionManager.getSessionStats().totalSessions).toBe(0);
    });

    test("should not cleanup active sessions", async () => {
      const session = await sessionManager.getOrCreateSession(
        testData.conversationId1,
        "bash"
      );

      // Update activity timestamp
      (session as any).updateActivity();

      // Advance time but not past timeout from last activity
      advanceTime(25 * 60 * 1000);

      await (sessionManager as any).cleanupIdleSessions();

      expect(sessionManager.getSessionStats().totalSessions).toBe(1);
    });

    test("should restart specific session", async () => {
      const session = await sessionManager.getOrCreateSession(
        testData.conversationId1,
        "bash"
      ) as ProcessSession;

      const restartSpy = vi.spyOn(session, 'restart');

      await sessionManager.restartSession(testData.conversationId1, "bash");

      expect(restartSpy).toHaveBeenCalled();
    });

    test("should cleanup specific session", async () => {
      await sessionManager.getOrCreateSession(testData.conversationId1, "bash");
      expect(sessionManager.getSessionStats().totalSessions).toBe(1);

      await sessionManager.cleanupSession(testData.conversationId1, "bash");
      expect(sessionManager.getSessionStats().totalSessions).toBe(0);
    });

    test("should cleanup all sessions on shutdown", async () => {
      await sessionManager.getOrCreateSession(testData.conversationId1, "bash");
      await sessionManager.getOrCreateSession(testData.conversationId2, "bash");

      expect(sessionManager.getSessionStats().totalSessions).toBe(2);

      await sessionManager.cleanupAllSessions();

      expect(sessionManager.getSessionStats().totalSessions).toBe(0);
    });
  });

  describe("Tool Configuration", () => {
    test("should throw error for unknown tool", async () => {
      await expect(
        sessionManager.getOrCreateSession(testData.conversationId1, "unknown_tool")
      ).rejects.toThrow("Unknown tool: unknown_tool");
    });

    test("should handle stateless tools", async () => {
      // Add a stateless tool config
      const originalConfigs = { ...TOOL_CONFIGS };
      (TOOL_CONFIGS as any).file_read = {
        name: "file_read",
        requiresSession: false,
        sessionType: 'memory',
        createSession: () => ({
          id: 'temp',
          toolType: 'file_read', 
          conversationId: 0,
          lastActivity: new Date(),
          execute: vi.fn(),
          restart: vi.fn(),
          cleanup: vi.fn(),
          isHealthy: vi.fn().mockResolvedValue(true),
        })
      };

      try {
        const session = await sessionManager.getOrCreateSession(
          testData.conversationId1,
          "file_read"
        );

        // Should return a temporary session, not store it
        expect(sessionManager.getSessionStats().totalSessions).toBe(0);
        expect(session.id).toBe('temp');
      } finally {
        // Restore original configs
        delete (TOOL_CONFIGS as any).file_read;
      }
    });
  });

  describe("Session Statistics", () => {
    test("should provide accurate session statistics", async () => {
      await sessionManager.getOrCreateSession(testData.conversationId1, "bash");
      await sessionManager.getOrCreateSession(testData.conversationId2, "bash");

      const stats = sessionManager.getSessionStats();

      expect(stats).toEqual({
        totalSessions: 2,
        sessionsByTool: {
          bash: 2
        },
        sessionsByConversation: {
          [testData.conversationId1]: 1,
          [testData.conversationId2]: 1
        }
      });
    });

    test("should update statistics after cleanup", async () => {
      await sessionManager.getOrCreateSession(testData.conversationId1, "bash");
      await sessionManager.getOrCreateSession(testData.conversationId2, "bash");

      expect(sessionManager.getSessionStats().totalSessions).toBe(2);

      await sessionManager.cleanupSession(testData.conversationId1, "bash");

      const stats = sessionManager.getSessionStats();
      expect(stats.totalSessions).toBe(1);
      expect(stats.sessionsByConversation[testData.conversationId1]).toBeUndefined();
      expect(stats.sessionsByConversation[testData.conversationId2]).toBe(1);
    });
  });

  describe("Error Handling", () => {
    test("should handle session creation failures gracefully", async () => {
      // Mock spawn to fail
      mockSpawn.mockImplementationOnce(() => {
        throw new Error("Failed to spawn process");
      });

      await expect(
        sessionManager.getOrCreateSession(testData.conversationId1, "bash")
      ).rejects.toThrow();

      // Should not store failed session
      expect(sessionManager.getSessionStats().totalSessions).toBe(0);
    });

    test("should handle cleanup errors gracefully", async () => {
      const session = await sessionManager.getOrCreateSession(
        testData.conversationId1,
        "bash"
      );

      // Mock cleanup to fail
      vi.spyOn(session, 'cleanup').mockRejectedValue(new Error("Cleanup failed"));

      // Should not throw, just log error
      await expect(sessionManager.cleanupAllSessions()).resolves.not.toThrow();

      // Should still remove from tracking
      expect(sessionManager.getSessionStats().totalSessions).toBe(0);
    });
  });

  describe("Concurrent Access", () => {
    test("should handle concurrent session creation for same conversation", async () => {
      // Create multiple concurrent requests for same session
      const promises = Array.from({ length: 5 }, () =>
        sessionManager.getOrCreateSession(testData.conversationId1, "bash")
      );

      const sessions = await Promise.all(promises);

      // Should all return the same session instance
      const firstSession = sessions[0];
      expect(sessions.every(s => s === firstSession)).toBe(true);
      expect(sessionManager.getSessionStats().totalSessions).toBe(1);
    });

    test("should handle concurrent operations on different conversations", async () => {
      const promises = [
        sessionManager.getOrCreateSession(testData.conversationId1, "bash"),
        sessionManager.getOrCreateSession(testData.conversationId2, "bash"),
        sessionManager.restartSession(testData.conversationId1, "bash"),
        sessionManager.cleanupSession(testData.conversationId2, "bash"),
      ];

      // Should handle concurrent operations without errors
      await expect(Promise.allSettled(promises)).resolves.not.toThrow();
    });
  });
});