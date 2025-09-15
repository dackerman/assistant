import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Enums
export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "pending",
  "queued",
  "processing",
  "completed",
  "error",
]);

export const blockTypeEnum = pgEnum("block_type", [
  "text",
  "thinking",
  "tool_use",
  "tool_result",
  "code",
  "error",
]);

export const promptStatusEnum = pgEnum("prompt_status", [
  "pending",
  "streaming",
  "completed",
  "error",
]);

export const toolStateEnum = pgEnum("tool_state", [
  "pending",
  "executing",
  "completed",
  "error",
  "timeout",
]);

export type MessageRole = (typeof messageRoleEnum.enumValues)[number];
export type MessageStatus = (typeof messageStatusEnum.enumValues)[number];
export type BlockType = (typeof blockTypeEnum.enumValues)[number];
export type PromptStatus = (typeof promptStatusEnum.enumValues)[number];
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
    role: messageRoleEnum("role").notNull(),
    content: text("content"), // For user messages mainly
    status: messageStatusEnum("status").notNull().default("pending"),
    queueOrder: integer("queue_order"), // For managing message queue
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    conversationIdx: index("idx_conversation_messages").on(
      table.conversationId,
      table.createdAt,
    ),
    queueIdx: index("idx_message_queue").on(
      table.conversationId,
      table.status,
      table.queueOrder,
    ),
  }),
);

export const blocks = pgTable(
  "blocks",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    type: blockTypeEnum("type").notNull(),
    content: text("content"),
    order: integer("order").notNull(),
    metadata: jsonb("metadata"), // Tool details, language for code blocks, etc.
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    messageIdx: index("idx_blocks_message").on(table.messageId, table.order),
    typeIdx: index("idx_blocks_type").on(table.type),
  }),
);

export const prompts = pgTable(
  "prompts",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    status: promptStatusEnum("status").notNull().default("pending"),
    model: text("model").notNull(),
    systemMessage: text("system_message"),
    request: jsonb("request"), // Store the full request sent to LLM
    response: jsonb("response"), // Store the final response
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    conversationIdx: index("idx_prompts_conversation").on(table.conversationId),
    statusIdx: index("idx_prompts_status").on(table.status),
    messageIdx: index("idx_prompts_message").on(table.messageId),
  }),
);

export const promptEvents = pgTable(
  "prompt_events",
  {
    id: serial("id").primaryKey(),
    promptId: integer("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // Raw event type from Anthropic
    data: jsonb("data").notNull(), // Raw event data
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    promptIdx: index("idx_prompt_events_prompt").on(table.promptId),
    createdAtIdx: index("idx_prompt_events_created").on(table.createdAt),
  }),
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: serial("id").primaryKey(),
    promptId: integer("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    blockId: integer("block_id").references(() => blocks.id, {
      onDelete: "cascade",
    }),
    apiToolCallId: text("api_tool_call_id").notNull(),
    name: text("name").notNull(),
    input: jsonb("input").notNull(),
    output: text("output"),
    state: toolStateEnum("state").notNull().default("pending"),
    error: text("error"),
    // Process tracking
    pid: integer("pid"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    timeoutAt: timestamp("timeout_at"),
    lastHeartbeat: timestamp("last_heartbeat"),
    // Retry logic
    retryCount: integer("retry_count").default(0).notNull(),
    maxRetries: integer("max_retries").default(3).notNull(),
    timeoutSeconds: integer("timeout_seconds").default(300).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    promptIdx: index("idx_tool_calls_prompt").on(table.promptId),
    blockIdx: index("idx_tool_calls_block").on(table.blockId),
    stateIdx: index("idx_tool_calls_state").on(table.state),
    pidIdx: index("idx_tool_calls_pid").on(table.pid),
    timeoutIdx: index("idx_tool_calls_timeout").on(
      table.state,
      table.timeoutAt,
    ),
  }),
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
}));

export const conversationsRelations = relations(
  conversations,
  ({ one, many }) => ({
    user: one(users, {
      fields: [conversations.userId],
      references: [users.id],
    }),
    messages: many(messages),
    prompts: many(prompts),
    activePrompt: one(prompts, {
      fields: [conversations.activePromptId],
      references: [prompts.id],
    }),
  }),
);

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  blocks: many(blocks),
  prompts: many(prompts),
}));

export const blocksRelations = relations(blocks, ({ one, many }) => ({
  message: one(messages, {
    fields: [blocks.messageId],
    references: [messages.id],
  }),
  toolCalls: many(toolCalls),
}));

export const promptsRelations = relations(prompts, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [prompts.conversationId],
    references: [conversations.id],
  }),
  message: one(messages, {
    fields: [prompts.messageId],
    references: [messages.id],
  }),
  events: many(promptEvents),
  toolCalls: many(toolCalls),
}));

export const promptEventsRelations = relations(promptEvents, ({ one }) => ({
  prompt: one(prompts, {
    fields: [promptEvents.promptId],
    references: [prompts.id],
  }),
}));

export const toolCallsRelations = relations(toolCalls, ({ one }) => ({
  prompt: one(prompts, {
    fields: [toolCalls.promptId],
    references: [prompts.id],
  }),
  block: one(blocks, {
    fields: [toolCalls.blockId],
    references: [blocks.id],
  }),
}));

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Block = typeof blocks.$inferSelect;
export type NewBlock = typeof blocks.$inferInsert;
export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type PromptEvent = typeof promptEvents.$inferSelect;
export type NewPromptEvent = typeof promptEvents.$inferInsert;
export type ToolCall = typeof toolCalls.$inferSelect;
export type NewToolCall = typeof toolCalls.$inferInsert;
