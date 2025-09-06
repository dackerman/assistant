import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { SessionManager, TOOL_CONFIGS } from "./sessionManager";

// Mock child_process using bun's mock
const mockSpawn = mock(() => ({
  pid: 12345,
  stdout: { on: mock() },
  stderr: { on: mock() },
  stdin: { write: mock() },
  on: mock(),
  kill: mock(),
  killed: false,
}));

// Mock the child_process module
mock.module("child_process", () => ({
  spawn: mockSpawn,
}));

describe("SessionManager Simple Tests", () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    mockSpawn.mockClear();
  });

  afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test("should create new bash session", async () => {
    const session = await sessionManager.getOrCreateSession(1, "bash");
    
    expect(session.id).toBe("1:bash");
    expect(session.toolType).toBe("bash");
    expect(session.conversationId).toBe(1);
    
    const stats = sessionManager.getSessionStats();
    expect(stats.totalSessions).toBe(1);
    expect(stats.sessionsByTool.bash).toBe(1);
  });

  test("should reuse existing session", async () => {
    const session1 = await sessionManager.getOrCreateSession(1, "bash");
    const session2 = await sessionManager.getOrCreateSession(1, "bash");
    
    expect(session1).toBe(session2);
    expect(sessionManager.getSessionStats().totalSessions).toBe(1);
  });

  test("should handle unknown tool error", async () => {
    try {
      await sessionManager.getOrCreateSession(1, "unknown_tool");
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect((error as Error).message).toBe("Unknown tool: unknown_tool");
    }
    
    expect(sessionManager.getSessionStats().totalSessions).toBe(0);
  });

  test("should provide accurate session statistics", async () => {
    await sessionManager.getOrCreateSession(1, "bash");
    await sessionManager.getOrCreateSession(2, "bash");
    
    const stats = sessionManager.getSessionStats();
    
    expect(stats.totalSessions).toBe(2);
    expect(stats.sessionsByTool.bash).toBe(2);
    expect(stats.sessionsByConversation[1]).toBe(1);
    expect(stats.sessionsByConversation[2]).toBe(1);
  });
});