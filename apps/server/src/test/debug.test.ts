import { describe, test, expect } from "vitest";
import { GenericContainer, Wait } from "testcontainers";

// Simple debug test to check TestContainers functionality
describe("TestContainers Debug", () => {
  test("should start a simple PostgreSQL container", async () => {
    console.log("🔧 Starting debug container test...");
    
    let container;
    try {
      console.log("🐳 Creating PostgreSQL container...");
      container = await new GenericContainer("postgres:16-alpine")
        .withEnvironment({
          POSTGRES_DB: "debug_db",
          POSTGRES_USER: "debug_user", 
          POSTGRES_PASSWORD: "debug_pass"
        })
        .withExposedPorts(5432)
        .withStartupTimeout(90000) // 90 second timeout
        .withWaitStrategy(
          Wait.forListeningPorts()
        )
        .start();
      
      console.log("✅ Container started successfully!");
      console.log(`📋 Container ID: ${container.getId()}`);
      console.log(`🔗 Connection URI: ${container.getConnectionUri()}`);
      
      // Basic connection test
      const host = container.getHost();
      const port = container.getMappedPort(5432);
      const connectionString = `postgresql://debug_user:debug_pass@${host}:${port}/debug_db`;
      console.log(`🔗 Connection string: ${connectionString}`);
      
      expect(host).toBeTruthy();
      expect(port).toBeGreaterThan(0);
      expect(connectionString).toContain("postgresql://");
      expect(connectionString).toContain("debug_user");
      expect(connectionString).toContain("debug_db");
      
    } catch (error) {
      console.error("❌ Container startup failed:", error);
      
      // Try to get Docker info
      try {
        const { execSync } = require("child_process");
        const dockerVersion = execSync("docker --version", { encoding: "utf8" });
        console.log(`🐳 Docker version: ${dockerVersion.trim()}`);
        
        const dockerInfo = execSync("docker info --format '{{.ServerVersion}}'", { encoding: "utf8" });
        console.log(`🐳 Docker server version: ${dockerInfo.trim()}`);
      } catch (dockerError) {
        console.error("❌ Could not get Docker info:", dockerError);
      }
      
      throw error;
    } finally {
      if (container) {
        console.log("🧹 Cleaning up container...");
        try {
          await container.stop();
          console.log("✅ Container stopped");
        } catch (stopError) {
          console.error("❌ Error stopping container:", stopError);
        }
      }
    }
  }, 90000); // 90 second timeout for this test
});