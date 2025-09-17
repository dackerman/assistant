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
  process.env.TEST_DATABASE_URL = container.getConnectionUri();
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

    CREATE OR REPLACE FUNCTION notify_block_created()
    RETURNS TRIGGER AS $$
    DECLARE
      prompt_record prompts%ROWTYPE;
    BEGIN
      SELECT * INTO prompt_record
      FROM prompts
      WHERE message_id = NEW.message_id
      ORDER BY created_at DESC
      LIMIT 1;

      IF prompt_record IS NOT NULL THEN
        PERFORM pg_notify(
          'prompt_stream_events',
          json_build_object(
            'type', 'block_start',
            'promptId', prompt_record.id,
            'conversationId', prompt_record.conversation_id,
            'messageId', prompt_record.message_id,
            'blockId', NEW.id,
            'blockType', NEW.type
          )::text
        );
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS block_created_notify ON blocks;
    CREATE TRIGGER block_created_notify
      AFTER INSERT ON blocks
      FOR EACH ROW
      EXECUTE FUNCTION notify_block_created();

    CREATE OR REPLACE FUNCTION notify_block_updated()
    RETURNS TRIGGER AS $$
    DECLARE
      prompt_record prompts%ROWTYPE;
      delta TEXT;
      previous_length INTEGER;
      new_length INTEGER;
    BEGIN
      IF NEW.content IS DISTINCT FROM OLD.content AND NEW.type = 'text' THEN
        previous_length := COALESCE(length(OLD.content), 0);
        new_length := COALESCE(length(NEW.content), 0);
        IF new_length > previous_length THEN
          delta := right(NEW.content, new_length - previous_length);
        ELSE
          delta := NEW.content;
        END IF;
      END IF;

      IF delta IS NULL OR delta = '' THEN
        RETURN NEW;
      END IF;

      SELECT * INTO prompt_record
      FROM prompts
      WHERE message_id = NEW.message_id
      ORDER BY created_at DESC
      LIMIT 1;

      IF prompt_record IS NOT NULL THEN
        PERFORM pg_notify(
          'prompt_stream_events',
          json_build_object(
            'type', 'block_delta',
            'promptId', prompt_record.id,
            'conversationId', prompt_record.conversation_id,
            'messageId', prompt_record.message_id,
            'blockId', NEW.id,
            'blockType', NEW.type,
            'delta', delta
          )::text
        );
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS block_updated_notify ON blocks;
    CREATE TRIGGER block_updated_notify
      AFTER UPDATE ON blocks
      FOR EACH ROW
      WHEN (OLD.content IS DISTINCT FROM NEW.content AND NEW.type = 'text')
      EXECUTE FUNCTION notify_block_updated();

    CREATE OR REPLACE FUNCTION notify_block_completed()
    RETURNS TRIGGER AS $$
    DECLARE
      prompt_record prompts%ROWTYPE;
      block_record blocks%ROWTYPE;
    BEGIN
      IF NEW.type <> 'content_block_stop' THEN
        RETURN NEW;
      END IF;

      SELECT * INTO prompt_record
      FROM prompts
      WHERE id = NEW.prompt_id
      LIMIT 1;

      IF prompt_record IS NULL THEN
        RETURN NEW;
      END IF;

      SELECT * INTO block_record
      FROM blocks
      WHERE message_id = prompt_record.message_id
        AND "order" = (NEW.data->>'index')::INTEGER
      ORDER BY id DESC
      LIMIT 1;

      IF block_record IS NOT NULL THEN
        PERFORM pg_notify(
          'prompt_stream_events',
          json_build_object(
            'type', 'block_end',
            'promptId', prompt_record.id,
            'conversationId', prompt_record.conversation_id,
            'messageId', prompt_record.message_id,
            'blockId', block_record.id
          )::text
        );
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS prompt_event_block_stop_notify ON prompt_events;
    CREATE TRIGGER prompt_event_block_stop_notify
      AFTER INSERT ON prompt_events
      FOR EACH ROW
      WHEN (NEW.type = 'content_block_stop')
      EXECUTE FUNCTION notify_block_completed();

    CREATE OR REPLACE FUNCTION notify_message_event()
    RETURNS TRIGGER AS $$
    DECLARE
      event_type TEXT;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        event_type := 'message_created';
      ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status IS DISTINCT FROM OLD.status
          OR NEW.content IS DISTINCT FROM OLD.content
          OR COALESCE(NEW.queue_order, -1) IS DISTINCT FROM COALESCE(OLD.queue_order, -1)
        THEN
          event_type := 'message_updated';
        ELSE
          RETURN NEW;
        END IF;
      ELSE
        RETURN NEW;
      END IF;

      PERFORM pg_notify(
        'conversation_events',
        json_build_object(
          'type', event_type,
          'conversationId', NEW.conversation_id,
          'message', json_build_object(
            'id', NEW.id,
            'conversationId', NEW.conversation_id,
            'role', NEW.role,
            'content', NEW.content,
            'status', NEW.status,
            'queueOrder', NEW.queue_order,
            'createdAt', NEW.created_at,
            'updatedAt', NEW.updated_at
          )
        )::text
      );

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS message_events_notify ON messages;
    CREATE TRIGGER message_events_notify
      AFTER INSERT OR UPDATE ON messages
      FOR EACH ROW
      EXECUTE FUNCTION notify_message_event();

    CREATE OR REPLACE FUNCTION notify_prompt_event()
    RETURNS TRIGGER AS $$
    DECLARE
      event_type TEXT;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'streaming' THEN
          event_type := 'prompt_started';
        ELSE
          RETURN NEW;
        END IF;
      ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status = 'completed' AND NEW.status IS DISTINCT FROM OLD.status THEN
          event_type := 'prompt_completed';
        ELSIF NEW.status = 'error' AND NEW.status IS DISTINCT FROM OLD.status THEN
          event_type := 'prompt_failed';
        ELSE
          RETURN NEW;
        END IF;
      ELSE
        RETURN NEW;
      END IF;

      PERFORM pg_notify(
        'conversation_events',
        json_build_object(
          'type', event_type,
          'conversationId', NEW.conversation_id,
          'prompt', json_build_object(
            'id', NEW.id,
            'conversationId', NEW.conversation_id,
            'messageId', NEW.message_id,
            'status', NEW.status,
            'model', NEW.model,
            'systemMessage', NEW.system_message,
            'createdAt', NEW.created_at,
            'completedAt', NEW.completed_at,
            'error', NEW.error
          )
        )::text
      );

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS prompt_events_notify ON prompts;
    CREATE TRIGGER prompt_events_notify
      AFTER INSERT OR UPDATE ON prompts
      FOR EACH ROW
      EXECUTE FUNCTION notify_prompt_event();
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
