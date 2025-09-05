CREATE TYPE "public"."block_type" AS ENUM('text', 'thinking', 'tool_call', 'attachment');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('block_start', 'block_delta', 'block_end');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."prompt_state" AS ENUM('CREATED', 'IN_PROGRESS', 'WAITING_FOR_TOOLS', 'FAILED', 'ERROR', 'COMPLETED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."tool_state" AS ENUM('created', 'running', 'complete', 'error', 'canceled');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"block_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"storage_url" text NOT NULL,
	"extracted_text" text
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt_id" integer NOT NULL,
	"message_id" integer,
	"type" "block_type" NOT NULL,
	"index_num" integer NOT NULL,
	"content" text,
	"metadata" jsonb,
	"is_finalized" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"active_prompt_id" integer
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt_id" integer NOT NULL,
	"index_num" integer NOT NULL,
	"type" "event_type" NOT NULL,
	"block_type" "block_type",
	"block_index" integer,
	"delta" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"prompt_id" integer,
	"role" "message_role" NOT NULL,
	"is_complete" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"message_id" integer,
	"state" "prompt_state" NOT NULL,
	"model" text NOT NULL,
	"system_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"error" text,
	"current_block" integer
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt_id" integer NOT NULL,
	"block_id" integer NOT NULL,
	"api_tool_call_id" text,
	"tool_name" text NOT NULL,
	"state" "tool_state" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_attachments_block_id" ON "attachments" USING btree ("block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_prompt_block_index" ON "blocks" USING btree ("prompt_id","index_num");--> statement-breakpoint
CREATE INDEX "idx_blocks_streaming" ON "blocks" USING btree ("prompt_id","index_num");--> statement-breakpoint
CREATE INDEX "idx_blocks_completed" ON "blocks" USING btree ("message_id","index_num");--> statement-breakpoint
CREATE INDEX "idx_user_conversations" ON "conversations" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_events_prompt_id" ON "events" USING btree ("prompt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_prompt_index" ON "events" USING btree ("prompt_id","index_num");--> statement-breakpoint
CREATE INDEX "idx_events_prompt_index" ON "events" USING btree ("prompt_id","index_num");--> statement-breakpoint
CREATE INDEX "idx_conversation_messages" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_prompts_state" ON "prompts" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_prompts_conversation" ON "prompts" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_prompts_last_updated" ON "prompts" USING btree ("last_updated");--> statement-breakpoint
CREATE INDEX "idx_tool_calls_prompt_id" ON "tool_calls" USING btree ("prompt_id");--> statement-breakpoint
CREATE INDEX "idx_tool_calls_block_id" ON "tool_calls" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "idx_tool_calls_state" ON "tool_calls" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_tool_calls_updated_at" ON "tool_calls" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_tool_calls_prompt_state" ON "tool_calls" USING btree ("prompt_id","state");