import { vi } from "vitest";

if (process.env.USE_REAL_PTY !== "1") {
  const spawnMock = vi.fn(() => {
    const listeners: { data?: (chunk: string) => void } = {};

    return {
      pid: Math.floor(Math.random() * 10000) + 1000,
      onData: vi.fn((handler: (chunk: string) => void) => {
        listeners.data = handler;
      }),
      onExit: vi.fn(),
      write: vi.fn((input: string) => {
        // Simulate immediate success response for tests
        listeners.data?.(input);
      }),
      kill: vi.fn(),
      resize: vi.fn(),
    };
  });

  vi.mock("node-pty", () => ({
    spawn: spawnMock,
  }));
}
