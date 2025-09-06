import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Wait } from "testcontainers";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";

let container: any;
let sql: any;
export let testDb: any;

export async function setupTestDatabase() {
  console.log("🔧 Starting TestContainers setup...");
  
  try {
    console.log("🐳 Creating PostgreSQL container...");
    
    // Start PostgreSQL container with correct wait strategy
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("test_db")
      .withUsername("test_user")
      .withPassword("test_pass")
      .withStartupTimeout(120000) // 2 minutes timeout
      .withWaitStrategy(
        Wait.forLogMessage("database system is ready to accept connections", 1)
      )
      .start();

    console.log("✅ Container started successfully");
    console.log(`📋 Container ID: ${container.getId()}`);
    
    const connectionString = container.getConnectionUri();
    console.log(`🔗 Connection string: ${connectionString}`);

    // Create connection
    console.log("🔌 Creating database connection...");
    sql = postgres(connectionString);
    testDb = drizzle(sql, { schema });

    // Test connection
    console.log("🧪 Testing database connection...");
    await sql`SELECT 1`;
    console.log("✅ Database connection successful");

    // Run migrations
    console.log("📋 Creating database tables...");
    await createTables();
    console.log("✅ Database setup complete");
    
  } catch (error) {
    console.error("❌ TestContainers setup failed:", error);
    
    // Try to get container logs if possible
    if (container) {
      try {
        const logs = await container.logs();
        console.log("📋 Container logs:");
        console.log(logs);
      } catch (logError) {
        console.error("❌ Could not retrieve container logs:", logError);
      }
    }
    
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
    
    if (container) {
      console.log("🛑 Stopping container...");
      await container.stop();
      console.log("✅ Container stopped successfully");
    }
    
    console.log("✅ Database teardown complete");
  } catch (error) {
    console.error("❌ Error during teardown:", error);
    throw error;
  }
}

async function createTables() {
  // Create tables manually for tests (simplified version)
  await sql`
    CREATE TYPE prompt_state AS ENUM (
      'CREATED', 'IN_PROGRESS', 'WAITING_FOR_TOOLS', 
      'FAILED', 'ERROR', 'COMPLETED', 'CANCELED'
    );
  `;

  await sql`
    CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
  `;

  await sql`
    CREATE TYPE block_type AS ENUM ('text', 'thinking', 'tool_call', 'attachment');
  `;

  await sql`
    CREATE TYPE event_type AS ENUM ('block_start', 'block_delta', 'block_end');
  `;

  await sql`
    CREATE TYPE tool_state AS ENUM ('created', 'running', 'complete', 'error', 'canceled');
  `;

  await sql`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await sql`
    CREATE TABLE conversations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      active_prompt_id INTEGER
    );
  `;

  await sql`
    CREATE TABLE messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      prompt_id INTEGER,
      role message_role NOT NULL,
      is_complete BOOLEAN DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await sql`
    CREATE TABLE prompts (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      message_id INTEGER REFERENCES messages(id),
      state prompt_state NOT NULL,
      model TEXT NOT NULL,
      system_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      error TEXT,
      current_block INTEGER
    );
  `;

  await sql`
    CREATE TABLE events (
      id SERIAL PRIMARY KEY,
      prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
      index_num INTEGER NOT NULL,
      type event_type NOT NULL,
      block_type block_type,
      block_index INTEGER,
      delta TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(prompt_id, index_num)
    );
  `;

  await sql`
    CREATE TABLE blocks (
      id SERIAL PRIMARY KEY,
      prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
      message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
      type block_type NOT NULL,
      index_num INTEGER NOT NULL,
      content TEXT,
      metadata JSONB,
      is_finalized BOOLEAN DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(prompt_id, index_num)
    );
  `;

  await sql`
    CREATE TABLE tool_calls (
      id SERIAL PRIMARY KEY,
      prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
      block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
      api_tool_call_id TEXT,
      tool_name TEXT NOT NULL,
      state tool_state NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      request JSONB NOT NULL,
      response JSONB,
      error TEXT,
      -- Tool execution tracking columns
      pid INTEGER,
      started_at TIMESTAMP,
      timeout_at TIMESTAMP,
      retry_count INTEGER DEFAULT 0 NOT NULL,
      last_heartbeat TIMESTAMP,
      output_stream TEXT,
      max_retries INTEGER DEFAULT 3 NOT NULL,
      timeout_seconds INTEGER DEFAULT 300 NOT NULL
    );
  `;

  await sql`
    CREATE TABLE attachments (
      id SERIAL PRIMARY KEY,
      block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      storage_url TEXT NOT NULL,
      extracted_text TEXT
    );
  `;
}
