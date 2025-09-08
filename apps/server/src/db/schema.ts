import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  json,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Enums
export const promptStateEnum = pgEnum("prompt_state", [
  "CREATED",
  "IN_PROGRESS",
  "WAITING_FOR_TOOLS",
  "FAILED",
  "ERROR",
  "COMPLETED",
  "CANCELED",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

export const blockTypeEnum = pgEnum("block_type", [
  "text",
  "thinking",
  "tool_call",
  "attachment",
]);

export const eventTypeEnum = pgEnum("event_type", [
  "block_start",
  "block_delta",
  "block_end",
  "message_stop",
]);

export const toolStateEnum = pgEnum("tool_state", [
  "created",
  "running",
  "complete",
  "error",
  "canceled",
]);

export type ToolState = (typeof toolStateEnum.enumValues)[number];

// Tables
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    title: text("title"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    activePromptId: integer("active_prompt_id"),
  },
  (table) => ({
    userIdIdx: index("idx_user_conversations").on(
      table.userId,
      table.updatedAt.desc(),
    ),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    promptId: integer("prompt_id"),
    role: messageRoleEnum("role").notNull(),
    isComplete: boolean("is_complete").default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    conversationIdx: index("idx_conversation_messages").on(
      table.conversationId,
      table.createdAt,
    ),
  }),
);

// export const prompts = pgTable(
//   "prompts",
//   {
//     id: serial("id").primaryKey(),
//     conversationId: integer("conversation_id")
//       .notNull()
//       .references(() => conversations.id, { onDelete: "cascade" }),
//     messageId: integer("message_id").references(() => messages.id),
//     state: promptStateEnum("state").notNull(),
//     model: text("model").notNull(),
//     systemMessage: text("system_message"),
//     createdAt: timestamp("created_at").notNull().defaultNow(),
//     lastUpdated: timestamp("last_updated").notNull().defaultNow(),
//     error: text("error"),
//     currentBlock: integer("current_block"),
//   },
//   (table) => ({
//     stateIdx: index("idx_prompts_state").on(table.state),
//     conversationIdx: index("idx_prompts_conversation").on(table.conversationId),
//     lastUpdatedIdx: index("idx_prompts_last_updated").on(table.lastUpdated),
//   }),
// );

export const llmRequestState = pgEnum("llm_request_state", [
  "started",
  "waiting_for_tools",
  "ready_for_continuation",
  "completed",
  "errored",
]);

export const llmProviders = pgEnum("llm_providers", [
  "anthropic",
  "openai",
  "xai",
  "google",
]);

export const prompts = pgTable("prompts", {
  id: serial("id").primaryKey(),
  provider: llmProviders("provider").notNull(),
  model: text("model").notNull(),
  request: json("request").notNull(),
  state: llmRequestState("state").notNull().default("started"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const promptEvents = pgTable("prompt_events", {
  id: serial("id").primaryKey(),
  prompt: integer("prompt_id")
    .notNull()
    .references(() => prompts.id),
  event: json("event").notNull(),
});

// export const events = pgTable(
//   "events",
//   {
//     id: serial("id").primaryKey(),
//     promptId: integer("prompt_id")
//       .notNull()
//       .references(() => prompts.id, { onDelete: "cascade" }),
//     indexNum: integer("index_num").notNull(),
//     type: eventTypeEnum("type").notNull(),
//     blockType: blockTypeEnum("block_type"),
//     blockIndex: integer("block_index"),
//     delta: text("delta"),
//     createdAt: timestamp("created_at").notNull().defaultNow(),
//   },
//   (table) => ({
//     promptIdIdx: index("idx_events_prompt_id").on(table.promptId),
//     uniquePromptIndex: uniqueIndex("unique_prompt_index").on(
//       table.promptId,
//       table.indexNum,
//     ),
//     promptIndexIdx: index("idx_events_prompt_index").on(
//       table.promptId,
//       table.indexNum,
//     ),
//   }),
// );

// export const blocks = pgTable(
//   "blocks",
//   {
//     id: serial("id").primaryKey(),
//     promptId: integer("prompt_id")
//       .notNull()
//       .references(() => prompts.id, { onDelete: "cascade" }),
//     messageId: integer("message_id").references(() => messages.id, {
//       onDelete: "cascade",
//     }),
//     type: blockTypeEnum("type").notNull(),
//     indexNum: integer("index_num").notNull(),
//     content: text("content"),
//     metadata: jsonb("metadata"),
//     isFinalized: boolean("is_finalized").default(false),
//     createdAt: timestamp("created_at").notNull().defaultNow(),
//     updatedAt: timestamp("updated_at").notNull().defaultNow(),
//   },
//   (table) => ({
//     uniquePromptBlockIndex: uniqueIndex("unique_prompt_block_index").on(
//       table.promptId,
//       table.indexNum,
//     ),
//     streamingIdx: index("idx_blocks_streaming").on(
//       table.promptId,
//       table.indexNum,
//     ),
//     completedIdx: index("idx_blocks_completed").on(
//       table.messageId,
//       table.indexNum,
//     ),
//   }),
// );

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: serial("id").primaryKey(),
    promptId: integer("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    apiToolCallId: text("api_tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    state: toolStateEnum("state").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    request: jsonb("request").notNull(),
    error: text("error"),
    // Tool execution tracking columns
    pid: integer("pid"),
    startedAt: timestamp("started_at"),
    timeoutAt: timestamp("timeout_at"),
    retryCount: integer("retry_count").default(0).notNull(),
    lastHeartbeat: timestamp("last_heartbeat"),
    outputStream: text("output_stream"),
    maxRetries: integer("max_retries").default(3).notNull(),
    timeoutSeconds: integer("timeout_seconds").default(300).notNull(),
  },
  (table) => ({
    promptIdIdx: index("idx_tool_calls_prompt_id").on(table.promptId),
    stateIdx: index("idx_tool_calls_state").on(table.state),
    updatedAtIdx: index("idx_tool_calls_updated_at").on(table.updatedAt),
    promptStateIdx: index("idx_tool_calls_prompt_state").on(
      table.promptId,
      table.state,
    ),
    // New indexes for tool execution
    pidIdx: index("idx_tool_calls_pid").on(table.pid),
    staleToolsIdx: index("idx_tool_calls_stale").on(
      table.state,
      table.lastHeartbeat,
    ),
    retryIdx: index("idx_tool_calls_retry").on(
      table.retryCount,
      table.maxRetries,
    ),
    timeoutIdx: index("idx_tool_calls_timeout").on(
      table.state,
      table.timeoutAt,
    ),
  }),
);

// export const attachments = pgTable(
//   "attachments",
//   {
//     id: serial("id").primaryKey(),
//     blockId: integer("block_id")
//       .notNull()
//       .references(() => blocks.id, { onDelete: "cascade" }),
//     fileName: text("file_name").notNull(),
//     mimeType: text("mime_type").notNull(),
//     fileSize: integer("file_size").notNull(),
//     storageUrl: text("storage_url").notNull(),
//     extractedText: text("extracted_text"),
//   },
//   (table) => ({
//     blockIdIdx: index("idx_attachments_block_id").on(table.blockId),
//   }),
// );

// // Relations
// export const conversationsRelations = relations(
//   conversations,
//   ({ one, many }) => ({
//     user: one(users, {
//       fields: [conversations.userId],
//       references: [users.id],
//     }),
//     messages: many(messages),
//     prompts: many(prompts),
//   }),
// );

// export const messagesRelations = relations(messages, ({ one, many }) => ({
//   conversation: one(conversations, {
//     fields: [messages.conversationId],
//     references: [conversations.id],
//   }),
//   prompt: one(prompts, {
//     fields: [messages.promptId],
//     references: [prompts.id],
//   }),
//   blocks: many(blocks),
// }));

// export const promptsRelations = relations(prompts, ({ one, many }) => ({
//   conversation: one(conversations, {
//     fields: [prompts.conversationId],
//     references: [conversations.id],
//   }),
//   message: one(messages, {
//     fields: [prompts.messageId],
//     references: [messages.id],
//   }),
//   events: many(events),
//   blocks: many(blocks),
//   toolCalls: many(toolCalls),
// }));

// export const blocksRelations = relations(blocks, ({ one, many }) => ({
//   prompt: one(prompts, {
//     fields: [blocks.promptId],
//     references: [prompts.id],
//   }),
//   message: one(messages, {
//     fields: [blocks.messageId],
//     references: [messages.id],
//   }),
//   toolCalls: many(toolCalls),
//   attachments: many(attachments),
// }));

// export const toolCallsRelations = relations(toolCalls, ({ one }) => ({
//   prompt: one(prompts, {
//     fields: [toolCalls.promptId],
//     references: [prompts.id],
//   }),
//   block: one(blocks, {
//     fields: [toolCalls.blockId],
//     references: [blocks.id],
//   }),
// }));

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type ToolCall = typeof toolCalls.$inferSelect;
export type NewToolCall = typeof toolCalls.$inferInsert;
