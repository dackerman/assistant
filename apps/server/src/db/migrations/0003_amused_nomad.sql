CREATE TYPE "public"."llm_providers" AS ENUM('anthropic', 'openai', 'xai', 'google');--> statement-breakpoint
CREATE TYPE "public"."llm_request_state" AS ENUM('started', 'waiting_for_tools', 'ready_for_continuation', 'completed', 'errored');--> statement-breakpoint
CREATE TABLE "prompt_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt_id" integer NOT NULL,
	"event" json NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "blocks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "attachments" CASCADE;--> statement-breakpoint
DROP TABLE "blocks" CASCADE;--> statement-breakpoint
DROP TABLE "events" CASCADE;--> statement-breakpoint
ALTER TABLE "prompts" DROP CONSTRAINT "prompts_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "prompts" DROP CONSTRAINT "prompts_message_id_messages_id_fk";
--> statement-breakpoint
DROP INDEX "idx_prompts_state";--> statement-breakpoint
DROP INDEX "idx_prompts_conversation";--> statement-breakpoint
DROP INDEX "idx_prompts_last_updated";--> statement-breakpoint
DROP INDEX "idx_tool_calls_block_id";--> statement-breakpoint
ALTER TABLE "prompts" ALTER COLUMN "state" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "prompts" ALTER COLUMN "state" SET DATA TYPE "public"."llm_request_state" USING "state"::text::"public"."llm_request_state";--> statement-breakpoint
ALTER TABLE "prompts" ALTER COLUMN "state" SET DEFAULT 'started';--> statement-breakpoint
ALTER TABLE "tool_calls" ALTER COLUMN "api_tool_call_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "provider" "llm_providers" NOT NULL;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "request" json NOT NULL;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "prompt_events" ADD CONSTRAINT "prompt_events_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" DROP COLUMN "conversation_id";--> statement-breakpoint
ALTER TABLE "prompts" DROP COLUMN "message_id";--> statement-breakpoint
ALTER TABLE "prompts" DROP COLUMN "system_message";--> statement-breakpoint
ALTER TABLE "prompts" DROP COLUMN "last_updated";--> statement-breakpoint
ALTER TABLE "prompts" DROP COLUMN "current_block";--> statement-breakpoint
ALTER TABLE "tool_calls" DROP COLUMN "block_id";--> statement-breakpoint
ALTER TABLE "tool_calls" DROP COLUMN "response";