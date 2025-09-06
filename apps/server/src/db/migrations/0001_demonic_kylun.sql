ALTER TABLE "tool_calls" ADD COLUMN "pid" integer;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "timeout_at" timestamp;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "last_heartbeat" timestamp;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "output_stream" text;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "max_retries" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "timeout_seconds" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_tool_calls_pid" ON "tool_calls" USING btree ("pid");--> statement-breakpoint
CREATE INDEX "idx_tool_calls_stale" ON "tool_calls" USING btree ("state","last_heartbeat");--> statement-breakpoint
CREATE INDEX "idx_tool_calls_retry" ON "tool_calls" USING btree ("retry_count","max_retries");--> statement-breakpoint
CREATE INDEX "idx_tool_calls_timeout" ON "tool_calls" USING btree ("state","timeout_at");