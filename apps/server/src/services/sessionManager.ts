import { spawn } from "child_process";
import type { ToolSession, ToolConfig } from "./toolSession.js";
import { ProcessSession } from "./processSession.js";
import { Logger } from "../utils/logger.js";

export class SessionManager {
  private sessions = new Map<string, ToolSession>();
  private logger = new Logger({ component: "SessionManager" });
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    // Start cleanup timer for idle sessions
    this.startCleanupTimer();
  }

  async getOrCreateSession(
    conversationId: number,
    toolName: string,
  ): Promise<ToolSession> {
    const config = TOOL_CONFIGS[toolName];

    if (!config) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    if (!config.requiresSession) {
      // Return a temporary stateless session for immediate execution
      return config.createSession(conversationId);
    }

    const sessionId = `${conversationId}:${toolName}`;
    let session = this.sessions.get(sessionId);

    if (!session) {
      this.logger.info("Creating new session", {
        sessionId,
        toolName,
        conversationId,
      });

      session = config.createSession(conversationId);
      this.sessions.set(sessionId, session);

      this.logger.info("Session created", {
        sessionId,
        totalSessions: this.sessions.size,
      });
    }

    return session;
  }

  async restartSession(
    conversationId: number,
    toolName: string,
  ): Promise<void> {
    const sessionId = `${conversationId}:${toolName}`;
    const session = this.sessions.get(sessionId);

    if (session) {
      this.logger.info("Restarting session", { sessionId });
      await session.restart();
    } else {
      this.logger.warn("Attempted to restart non-existent session", {
        sessionId,
      });
    }
  }

  async cleanupSession(
    conversationId: number,
    toolName: string,
  ): Promise<void> {
    const sessionId = `${conversationId}:${toolName}`;
    const session = this.sessions.get(sessionId);

    if (session) {
      this.logger.info("Cleaning up session", { sessionId });
      await session.cleanup();
      this.sessions.delete(sessionId);
    }
  }

  async cleanupAllSessions(): Promise<void> {
    this.logger.info("Cleaning up all sessions", {
      sessionCount: this.sessions.size,
    });

    const cleanupPromises = Array.from(this.sessions.values()).map((session) =>
      session.cleanup().catch((error) => {
        this.logger.error("Error during session cleanup", {
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    );

    await Promise.allSettled(cleanupPromises);
    this.sessions.clear();

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.logger.info("All sessions cleaned up");
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(
      async () => {
        await this.cleanupIdleSessions();
      },
      5 * 60 * 1000,
    ); // Check every 5 minutes
  }

  private async cleanupIdleSessions(): Promise<void> {
    const now = new Date();
    const sessionsToCleanup: ToolSession[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      const config = TOOL_CONFIGS[session.toolType];
      const timeout = config?.sessionTimeout || 30 * 60 * 1000; // Default 30 minutes
      const idleTime = now.getTime() - session.lastActivity.getTime();

      if (idleTime > timeout) {
        this.logger.info("Session idle timeout", {
          sessionId,
          idleMinutes: Math.floor(idleTime / 60000),
        });
        sessionsToCleanup.push(session);
      }
    }

    // Cleanup idle sessions
    for (const session of sessionsToCleanup) {
      try {
        await session.cleanup();
        this.sessions.delete(session.id);

        this.logger.info("Cleaned up idle session", {
          sessionId: session.id,
        });
      } catch (error) {
        this.logger.error("Failed to cleanup idle session", {
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Get session stats for monitoring
  getSessionStats(): {
    totalSessions: number;
    sessionsByTool: Record<string, number>;
    sessionsByConversation: Record<number, number>;
  } {
    const sessionsByTool: Record<string, number> = {};
    const sessionsByConversation: Record<number, number> = {};

    for (const session of this.sessions.values()) {
      sessionsByTool[session.toolType] =
        (sessionsByTool[session.toolType] || 0) + 1;
      sessionsByConversation[session.conversationId] =
        (sessionsByConversation[session.conversationId] || 0) + 1;
    }

    return {
      totalSessions: this.sessions.size,
      sessionsByTool,
      sessionsByConversation,
    };
  }
}

// Tool configuration - starting with just bash
export const TOOL_CONFIGS: Record<string, ToolConfig> = {
  bash: {
    name: "bash",
    requiresSession: true,
    sessionType: "process",
    sessionTimeout: 30 * 60 * 1000, // 30 minutes
    restartable: true,
    createSession: (conversationId: number) =>
      new ProcessSession("bash", conversationId, () =>
        spawn("bash", ["-i"], {
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            PS1: "$ ",
            // Disable bash history to avoid file conflicts
            HISTFILE: "/dev/null",
          },
        }),
      ),
  },
};
