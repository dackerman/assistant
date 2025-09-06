import { describe, test, expect } from "vitest";
import { GenericContainer, Wait } from "testcontainers";

// Disable Ryuk reaper to avoid "Started" timeout issue
process.env["TESTCONTAINERS_RYUK_DISABLED"] = "true";

// Standalone test not affected by vitest config
describe("Standalone TestContainers Test", () => {
  test("should start PostgreSQL with GenericContainer", async () => {
    console.log("🚀 Starting standalone test...");
    
    let container;
    try {
      console.log("🐳 Creating PostgreSQL container with GenericContainer...");
      
      container = await new GenericContainer("postgres:16-alpine")
        .withEnvironment({
          POSTGRES_DB: "test_db",
          POSTGRES_USER: "test_user",
          POSTGRES_PASSWORD: "test_pass"
        })
        .withExposedPorts(5432)
        .withStartupTimeout(30000)
        .withWaitStrategy(Wait.forListeningPorts())
        .start();
      
      console.log("✅ Container started!");
      console.log(`📋 Container ID: ${container.getId()}`);
      
      const host = container.getHost();
      const port = container.getMappedPort(5432);
      
      console.log(`🔗 Host: ${host}, Port: ${port}`);
      
      expect(host).toBeTruthy();
      expect(port).toBeGreaterThan(0);
      
    } catch (error) {
      console.error("❌ Test failed:", error);
      throw error;
    } finally {
      if (container) {
        console.log("🧹 Stopping container...");
        await container.stop();
      }
    }
  }, 120000);
});