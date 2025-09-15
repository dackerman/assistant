import { describe, expect, it } from "vitest";
import { Logger } from "../utils/logger.js";
import { BashSession } from "./bashSession.js";

describe("BashSession basic tests", () => {
  it("should create a bash session instance", () => {
    const logger = new Logger();
    const session = new BashSession(logger);
    expect(session).toBeDefined();
    expect(session.alive).toBe(false);
  });

  it("should start and execute a simple command", async () => {
    const logger = new Logger();
    const session = new BashSession(logger, { timeout: 10000 });

    try {
      await session.start();
      expect(session.alive).toBe(true);

      const result = await session.exec('echo "test"');
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("test");

      await session.stop();
      expect(session.alive).toBe(false);
    } catch (error) {
      // Clean up on error
      await session.stop();
      throw error;
    }
  }, 15000);
});
