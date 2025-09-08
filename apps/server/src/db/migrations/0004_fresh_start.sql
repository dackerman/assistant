-- Drop all existing tables and start fresh
DROP TABLE IF EXISTS "attachments" CASCADE;
DROP TABLE IF EXISTS "blocks" CASCADE; 
DROP TABLE IF EXISTS "events" CASCADE;
DROP TABLE IF EXISTS "tool_calls" CASCADE;
DROP TABLE IF EXISTS "prompts" CASCADE;
DROP TABLE IF EXISTS "messages" CASCADE;
DROP TABLE IF EXISTS "conversations" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "prompt_events" CASCADE;

-- Drop old enums
DROP TYPE IF EXISTS "prompt_state" CASCADE;
DROP TYPE IF EXISTS "message_role" CASCADE;
DROP TYPE IF EXISTS "block_type" CASCADE;
DROP TYPE IF EXISTS "event_type" CASCADE;
DROP TYPE IF EXISTS "tool_state" CASCADE;

-- Create new clean enums
CREATE TYPE "llm_providers" AS ENUM('anthropic', 'openai', 'xai', 'google');
CREATE TYPE "llm_request_state" AS ENUM('started', 'waiting_for_tools', 'ready_for_continuation', 'completed', 'errored');
CREATE TYPE "tool_state" AS ENUM('created', 'running', 'complete', 'error', 'canceled');

-- Create clean tables for PromptService
CREATE TABLE "prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" "llm_providers" NOT NULL,
	"model" text NOT NULL,
	"request" json NOT NULL,
	"state" "llm_request_state" NOT NULL DEFAULT 'started',
	"error" text,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"completed_at" timestamp
);

CREATE TABLE "prompt_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt_id" integer NOT NULL,
	"event" json NOT NULL,
	CONSTRAINT "prompt_events_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE CASCADE
);

CREATE TABLE "tool_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt_id" integer NOT NULL,
	"api_tool_call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"state" "tool_state" NOT NULL,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now(),
	"request" jsonb NOT NULL,
	"error" text,
	"pid" integer,
	"started_at" timestamp,
	"timeout_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_heartbeat" timestamp,
	"output_stream" text,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"timeout_seconds" integer DEFAULT 300 NOT NULL,
	CONSTRAINT "tool_calls_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX "idx_tool_calls_prompt_id" ON "tool_calls" ("prompt_id");
CREATE INDEX "idx_tool_calls_state" ON "tool_calls" ("state");
CREATE INDEX "idx_tool_calls_updated_at" ON "tool_calls" ("updated_at");
CREATE INDEX "idx_tool_calls_prompt_state" ON "tool_calls" ("prompt_id","state");
CREATE INDEX "idx_tool_calls_pid" ON "tool_calls" ("pid");
CREATE INDEX "idx_tool_calls_stale" ON "tool_calls" ("state","last_heartbeat");