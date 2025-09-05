import { defineConfig } from "vitest/config";

const runDbTests = process.env.RUN_DB_TESTS === "1";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: runDbTests ? ["./src/test/setup.ts"] : [],
    include: runDbTests ? ["src/**/*.test.ts"] : [],
    passWithNoTests: true,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
