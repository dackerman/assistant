import { Logger } from "../utils/logger";
import type { BashSessionFactory, BashSessionLike } from "./bashSession";

export interface SessionConfig {
  workingDirectory?: string;
  timeout?: number;
  environment?: Record<string, string>;
}

/**
 * SessionManager manages BashSession instances per conversation.
 * Each conversation gets its own persistent bash session.
 */
export class SessionManager {
  private sessions = new Map<number, BashSessionLike>();
  private logger: Logger;
  private defaultConfig: SessionConfig;
  private sessionFactory: (
    logger: Logger,
    config: SessionConfig,
  ) => Promise<BashSessionLike>;

  constructor(
    config: SessionConfig = {},
    sessionFactory?: BashSessionFactory,
  ) {
    this.logger = new Logger({ service: "SessionManager" });
    this.defaultConfig = {
      workingDirectory: config.workingDirectory || process.cwd(),
      timeout: config.timeout || 300000, // 5 minutes
      environment: config.environment || {},
    };
    this.sessionFactory = sessionFactory
      ? async (logger, factoryConfig) =>
          await sessionFactory(logger, factoryConfig)
      : async (logger, factoryConfig) => {
          const { BashSession } = await import("./bashSession.js");
          return new BashSession(logger, factoryConfig);
        };
  }

  /**
   * Get or create a bash session for a conversation
   */
  async getSession(conversationId: number): Promise<BashSessionLike> {
    let session = this.sessions.get(conversationId);

    if (!session) {
      this.logger.info("Creating new bash session", { conversationId });

      session = await this.sessionFactory(
        this.logger.child({ conversationId }),
        {
          ...this.defaultConfig,
          // Each conversation gets its own working directory if needed
          workingDirectory: this.defaultConfig.workingDirectory,
        },
      );

      await session.start();
      this.sessions.set(conversationId, session);

      this.logger.info("Bash session created and started", {
        conversationId,
        pid: session.pid,
      });
    }

    return session;
  }

  /**
   * Check if a session exists for a conversation
   */
  hasSession(conversationId: number): boolean {
    return this.sessions.has(conversationId);
  }

  /**
   * Get session if it exists, but don't create it
   */
  getExistingSession(conversationId: number): BashSessionLike | null {
    return this.sessions.get(conversationId) || null;
  }

  /**
   * Destroy a session for a conversation
   */
  async destroySession(conversationId: number): Promise<void> {
    const session = this.sessions.get(conversationId);

    if (session) {
      this.logger.info("Destroying bash session", {
        conversationId,
        pid: session.pid,
      });

      try {
        await session.stop();
      } catch (error) {
        this.logger.error("Error stopping bash session", {
          conversationId,
          error,
        });
      }

      this.sessions.delete(conversationId);

      this.logger.info("Bash session destroyed", { conversationId });
    }
  }

  /**
   * Destroy all sessions (cleanup on shutdown)
   */
  async destroyAllSessions(): Promise<void> {
    this.logger.info("Destroying all bash sessions", {
      sessionCount: this.sessions.size,
    });

    const destroyPromises = Array.from(this.sessions.keys()).map(
      (conversationId) => this.destroySession(conversationId),
    );

    await Promise.all(destroyPromises);

    this.logger.info("All bash sessions destroyed");
  }

  /**
   * Get stats about active sessions
   */
  getStats() {
    const activeSessions = Array.from(this.sessions.entries()).map(
      ([conversationId, session]) => ({
        conversationId,
        pid: session.pid,
        alive: session.alive,
      }),
    );

    return {
      totalSessions: this.sessions.size,
      activeSessions,
    };
  }

  /**
   * Cleanup dead sessions
   */
  async cleanupDeadSessions(): Promise<void> {
    const deadSessions: number[] = [];

    for (const [conversationId, session] of this.sessions.entries()) {
      if (!session.alive) {
        deadSessions.push(conversationId);
      }
    }

    if (deadSessions.length > 0) {
      this.logger.info("Cleaning up dead sessions", {
        deadSessionCount: deadSessions.length,
        conversationIds: deadSessions,
      });

      for (const conversationId of deadSessions) {
        this.sessions.delete(conversationId);
      }
    }
  }

  /**
   * Start periodic cleanup of dead sessions
   */
  startPeriodicCleanup(intervalMs = 60000): NodeJS.Timeout {
    return setInterval(() => {
      this.cleanupDeadSessions().catch((error) => {
        this.logger.error("Error during periodic session cleanup", { error });
      });
    }, intervalMs);
  }
}
