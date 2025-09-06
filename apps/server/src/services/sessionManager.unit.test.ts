import { vi } from "vitest";

// Mock child_process - must be at the top
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ProcessSession } from "./processSession";
import { SessionManager, TOOL_CONFIGS } from "./sessionManager";

describe("SessionManager Unit Tests", () => {
  let sessionManager: SessionManager;
  let mockSpawn: any;

  beforeEach(async () => {
    sessionManager = new SessionManager();
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

    const { spawn } =
      await vi.importMock<typeof import("child_process")>("child_process");
    mockSpawn = spawn;
    (mockSpawn as any).mockReturnValue(mockProcess);
  });

  afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  describe("Session Creation and Management", () => {
    test("should create new bash session", async () => {
      const session = await sessionManager.getOrCreateSession(1, "bash");

      expect(session.id).toBe("1:bash");
      expect(session.toolType).toBe("bash");
      expect(session.conversationId).toBe(1);
      expect(mockSpawn).toHaveBeenCalledWith(
        "bash",
        ["-i"],
        expect.any(Object),
      );

      const stats = sessionManager.getSessionStats();
      expect(stats.totalSessions).toBe(1);
      expect(stats.sessionsByTool.bash).toBe(1);
    });

    test("should reuse existing session", async () => {
      const session1 = await sessionManager.getOrCreateSession(1, "bash");
      const session2 = await sessionManager.getOrCreateSession(1, "bash");

      expect(session1).toBe(session2);
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(sessionManager.getSessionStats().totalSessions).toBe(1);
    });

    test("should create separate sessions for different conversations", async () => {
      const session1 = await sessionManager.getOrCreateSession(1, "bash");
      const session2 = await sessionManager.getOrCreateSession(2, "bash");

      expect(session1).not.toBe(session2);
      expect(session1.id).toBe("1:bash");
      expect(session2.id).toBe("2:bash");
      expect(mockSpawn).toHaveBeenCalledTimes(2);

      const stats = sessionManager.getSessionStats();
      expect(stats.totalSessions).toBe(2);
      expect(stats.sessionsByConversation[1]).toBe(1);
      expect(stats.sessionsByConversation[2]).toBe(1);
    });

    test("should handle unknown tool error", async () => {
      await expect(
        sessionManager.getOrCreateSession(1, "unknown_tool"),
      ).rejects.toThrow("Unknown tool: unknown_tool");

      expect(sessionManager.getSessionStats().totalSessions).toBe(0);
    });

    test("should cleanup specific session", async () => {
      const session = (await sessionManager.getOrCreateSession(
        1,
        "bash",
      )) as ProcessSession;
      const cleanupSpy = vi
        .spyOn(session, "cleanup")
        .mockResolvedValue(undefined);

      expect(sessionManager.getSessionStats().totalSessions).toBe(1);

      await sessionManager.cleanupSession(1, "bash");

      expect(cleanupSpy).toHaveBeenCalled();
      expect(sessionManager.getSessionStats().totalSessions).toBe(0);
    });

    test("should restart specific session", async () => {
      const session = (await sessionManager.getOrCreateSession(
        1,
        "bash",
      )) as ProcessSession;
      const restartSpy = vi
        .spyOn(session, "restart")
        .mockResolvedValue(undefined);

      await sessionManager.restartSession(1, "bash");

      expect(restartSpy).toHaveBeenCalled();
    });

    test("should cleanup all sessions", async () => {
      const session1 = (await sessionManager.getOrCreateSession(
        1,
        "bash",
      )) as ProcessSession;
      const session2 = (await sessionManager.getOrCreateSession(
        2,
        "bash",
      )) as ProcessSession;

      const cleanup1Spy = vi
        .spyOn(session1, "cleanup")
        .mockResolvedValue(undefined);
      const cleanup2Spy = vi
        .spyOn(session2, "cleanup")
        .mockResolvedValue(undefined);

      expect(sessionManager.getSessionStats().totalSessions).toBe(2);

      await sessionManager.cleanupAllSessions();

      expect(cleanup1Spy).toHaveBeenCalled();
      expect(cleanup2Spy).toHaveBeenCalled();
      expect(sessionManager.getSessionStats().totalSessions).toBe(0);
    });
  });

  describe("Session Statistics", () => {
    test("should provide accurate session statistics", async () => {
      await sessionManager.getOrCreateSession(1, "bash");
      await sessionManager.getOrCreateSession(2, "bash");

      const stats = sessionManager.getSessionStats();

      expect(stats).toEqual({
        totalSessions: 2,
        sessionsByTool: {
          bash: 2,
        },
        sessionsByConversation: {
          1: 1,
          2: 1,
        },
      });
    });

    test("should update statistics after cleanup", async () => {
      await sessionManager.getOrCreateSession(1, "bash");
      await sessionManager.getOrCreateSession(2, "bash");

      await sessionManager.cleanupSession(1, "bash");

      const stats = sessionManager.getSessionStats();
      expect(stats.totalSessions).toBe(1);
      expect(stats.sessionsByConversation[1]).toBeUndefined();
      expect(stats.sessionsByConversation[2]).toBe(1);
    });
  });

  describe("Error Handling", () => {
    test("should handle session creation failures", async () => {
      (mockSpawn as any).mockImplementationOnce(() => {
        throw new Error("Failed to spawn process");
      });

      await expect(
        sessionManager.getOrCreateSession(1, "bash"),
      ).rejects.toThrow("Failed to spawn process");

      expect(sessionManager.getSessionStats().totalSessions).toBe(0);
    });

    test("should handle cleanup errors gracefully", async () => {
      const session = (await sessionManager.getOrCreateSession(
        1,
        "bash",
      )) as ProcessSession;
      vi.spyOn(session, "cleanup").mockRejectedValue(
        new Error("Cleanup failed"),
      );

      await expect(sessionManager.cleanupAllSessions()).resolves.not.toThrow();
      expect(sessionManager.getSessionStats().totalSessions).toBe(0);
    });
  });

  describe("Concurrent Operations", () => {
    test("should handle concurrent session creation", async () => {
      const promises = Array.from({ length: 5 }, () =>
        sessionManager.getOrCreateSession(1, "bash"),
      );

      const sessions = await Promise.all(promises);

      const firstSession = sessions[0];
      expect(sessions.every((s) => s === firstSession)).toBe(true);
      expect(sessionManager.getSessionStats().totalSessions).toBe(1);
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
  });
});
