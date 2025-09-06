import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../db/schema";

let sql: any;
export let testDb: any;

export async function setupTestDatabase() {
  console.log("🔧 Starting database setup...");

  try {
    // Connect to external test database
    const connectionString =
      "postgres://test_user:test_pass@localhost:15432/test_db";
    console.log(`🔗 Connecting to: ${connectionString}`);

    // Create connection
    console.log("🔌 Creating database connection...");
    sql = postgres(connectionString, { max: 1 });
    testDb = drizzle(sql, { schema });

    // Test connection
    console.log("🧪 Testing database connection...");
    await sql`SELECT 1`;
    console.log("✅ Database connection successful");

    // Run migrations
    console.log("📋 Running database migrations...");
    await migrate(testDb, { migrationsFolder: "./src/db/migrations" });
    console.log("✅ Database setup complete");
  } catch (error) {
    console.error("❌ Database setup failed:", error);
    throw error;
  }
}

export async function teardownTestDatabase() {
  console.log("🧹 Starting database teardown...");

  try {
    if (sql) {
      console.log("🔌 Closing database connection...");
      await sql.end();
      console.log("✅ Database connection closed");
    }

    console.log("✅ Database teardown complete");
  } catch (error) {
    console.error("❌ Error during teardown:", error);
    throw error;
  }
}
