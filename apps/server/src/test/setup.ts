import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import * as schema from "../db/schema";

let container: StartedPostgreSqlContainer | null = null;
let pool: Pool | null = null;
export let testDb: NodePgDatabase<typeof schema>;

export async function setupTestDatabase() {
  if (!container) {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("test_db")
      .withUsername("test_user")
      .withPassword("test_pass")
      .start();
  }

  pool = new Pool({
    connectionString: container.getConnectionUri(),
  });
  await pool.query(`
    DROP TABLE IF EXISTS tool_calls CASCADE;
    DROP TABLE IF EXISTS prompt_events CASCADE;
    DROP TABLE IF EXISTS prompts CASCADE;
    DROP TABLE IF EXISTS blocks CASCADE;
    DROP TABLE IF EXISTS messages CASCADE;
    DROP TABLE IF EXISTS conversations CASCADE;
    DROP TABLE IF EXISTS users CASCADE;

    DROP TYPE IF EXISTS message_role CASCADE;
    DROP TYPE IF EXISTS message_status CASCADE;
    DROP TYPE IF EXISTS block_type CASCADE;
    DROP TYPE IF EXISTS prompt_status CASCADE;
    DROP TYPE IF EXISTS tool_state CASCADE;

    CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
    CREATE TYPE message_status AS ENUM ('pending', 'queued', 'processing', 'completed', 'error');
    CREATE TYPE block_type AS ENUM ('text', 'thinking', 'tool_use', 'tool_result', 'code', 'error');
    CREATE TYPE prompt_status AS ENUM ('pending', 'streaming', 'completed', 'error');
    CREATE TYPE tool_state AS ENUM ('pending', 'executing', 'completed', 'error', 'timeout');

    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE conversations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      active_prompt_id INTEGER
    );

    CREATE TABLE messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role message_role NOT NULL,
      content TEXT,
      status message_status NOT NULL DEFAULT 'pending',
      queue_order INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE blocks (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      type block_type NOT NULL,
      content TEXT,
      "order" INTEGER NOT NULL,
      metadata JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE prompts (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      status prompt_status NOT NULL DEFAULT 'pending',
      model TEXT NOT NULL,
      system_message TEXT,
      request JSONB,
      response JSONB,
      error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP
    );

    CREATE TABLE prompt_events (
      id SERIAL PRIMARY KEY,
      prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE tool_calls (
      id SERIAL PRIMARY KEY,
      prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
      block_id INTEGER REFERENCES blocks(id) ON DELETE CASCADE,
      api_tool_call_id TEXT NOT NULL,
      name TEXT NOT NULL,
      input JSONB NOT NULL,
      output TEXT,
      state tool_state NOT NULL DEFAULT 'pending',
      error TEXT,
      pid INTEGER,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      timeout_at TIMESTAMP,
      last_heartbeat TIMESTAMP,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      timeout_seconds INTEGER NOT NULL DEFAULT 300,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_blocks_message ON blocks (message_id, "order");
    CREATE INDEX idx_blocks_type ON blocks (type);
    CREATE INDEX idx_prompts_conversation ON prompts (conversation_id);
    CREATE INDEX idx_prompts_status ON prompts (status);
    CREATE INDEX idx_prompts_message ON prompts (message_id);
    CREATE INDEX idx_prompt_events_prompt ON prompt_events (prompt_id);
    CREATE INDEX idx_prompt_events_created ON prompt_events (created_at);
    CREATE INDEX idx_tool_calls_prompt ON tool_calls (prompt_id);
    CREATE INDEX idx_tool_calls_block ON tool_calls (block_id);
    CREATE INDEX idx_tool_calls_state ON tool_calls (state);
    CREATE INDEX idx_tool_calls_pid ON tool_calls (pid);
    CREATE INDEX idx_tool_calls_timeout ON tool_calls (state, timeout_at);
  `);

  testDb = drizzle(pool, { schema });
}

export async function teardownTestDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
  }

  if (container) {
    await container.stop();
    container = null;
  }
}
