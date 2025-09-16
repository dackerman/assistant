# Backend Conversation Service Test Plan

This plan focuses on the end-to-end behaviors that exercise the conversation service and its downstream collaborators (prompt service, tool execution, and database models). Each scenario can be covered with integration or high-level service tests that run against a real Postgres database to validate data persistence.

## 1. Conversation Creation Flow
- **Trigger:** `ConversationService.createConversation(userId, title?)`
- **Expected behavior:**
  - Inserts a row into `conversations` with the provided user, default title when omitted, and timestamps.
  - Returns the new conversation id.
- **Verification:**
  - Query `conversations` to assert the row exists with correct user, title, and timestamps.
  - Ensure no dependent tables (`messages`, `prompts`, etc.) receive entries during creation.

## 2. Queueing First User Message
- **Trigger:** `ConversationService.queueMessage(conversationId, content)` for a conversation with no active prompt.
- **Expected behavior:**
  - Inserts a queued user message and text block snapshot of the request.
  - Marks the user message as `completed` once the queue processor runs.
  - Creates an assistant placeholder message (`status = processing`).
  - Kicks off prompt streaming (delegates to `PromptService.createAndStreamPrompt`).
- **Verification:**
  - `messages` table contains the queued/completed user message and the processing assistant message with proper queue ordering.
  - `blocks` table contains a text block for the user message.
  - `prompts` table has an entry in `streaming` state tied to the assistant message.
  - `conversations.active_prompt_id` set to the newly created prompt id.

## 3. Prompt Streaming Completion Without Tools
- **Trigger:** Drive `PromptService.createAndStreamPrompt` callbacks to completion with simple text events.
- **Expected behavior:**
  - Inserts prompt events (`prompt_events`) for each stream event.
  - Appends assistant text to the existing assistant message block(s).
  - Marks the assistant message `completed` and clears `conversations.active_prompt_id` via `handlePromptComplete`.
- **Verification:**
  - `messages` shows assistant message status `completed` and text block content accumulated.
  - `prompts.status` transitions to `completed` with `completed_at` populated.
  - No tool call rows are created.

## 4. Prompt Streaming With Tool Execution
- **Trigger:** Simulate stream events containing `tool_use` blocks; allow `ToolExecutorService` to execute (mock or real bash session).
- **Expected behavior:**
  - Creates a `tool_use` block for the assistant message.
  - Inserts corresponding `tool_calls` row (`state` transitions from `pending` → `executing` → `completed/errors`).
  - Appends a follow-up text block after tool execution with aggregated tool results.
  - Stores prompt events for both the tool call and the continuation pass.
- **Verification:**
  - `tool_calls` table contains entries linked to the prompt and block with serialized parameters/result.
  - Continuation request replays tool result as a synthetic user tool result block (verify via `prompt_events` and assistant message blocks).
  - Final prompt state is `completed` and assistant message marked `completed`.

## 5. Conversation Retrieval With Blocks & Tool Calls
- **Trigger:** `ConversationService.getConversation(conversationId, userId)` after flows 2–4.
- **Expected behavior:**
  - Returns conversation metadata along with all messages ordered (user + assistant, including processing messages if any remain).
  - Each message includes associated blocks; tool result blocks embed `toolCall` data.
- **Verification:**
  - Response payload contains correct structure (message count, block order, tool call attachments).
  - DB reads should match inserted rows from previous scenarios.

## 6. Active Stream Recovery
- **Trigger:** Call `ConversationService.getActiveStream(conversationId)` while a prompt is still `streaming`.
- **Expected behavior:**
  - Returns the active prompt plus all non-finalized blocks for the assistant message so a client can resume streaming.
- **Verification:**
  - Response includes prompt metadata and block list limited to the active assistant message.
  - After prompt completion (`handlePromptComplete`), subsequent calls return `null`.

## 7. Title Update & Conversation Deletion
- **Trigger:** `ConversationService.createConversation`, then `updateConversationTitle`, then `deleteConversation` (via exposed service methods if available, otherwise equivalent repo helpers).
- **Expected behavior:**
  - Title update persists to `conversations.title` and bumps `updated_at` timestamp.
  - Deletion cascades to messages, blocks, prompts, prompt events, and tool calls (thanks to FK cascade rules).
- **Verification:**
  - After update, query verifies new title and timestamp.
  - After delete, `conversations` row removed and dependent tables empty for that conversation id.

## 8. Conversation Listing & Sidebar Data
- **Trigger:** Seed multiple conversations and call `conversationService.listConversations()` (frontend API client).
- **Expected behavior:**
  - HTTP layer returns conversations ordered by `updatedAt` desc with ids, titles, timestamps.
- **Verification:**
  - Response ordering matches expected sorting logic.
  - Newly updated conversations bubble to top after sending messages or changing titles.

## 9. Error Handling / Retry Paths
- **Trigger:** Force failures in prompt streaming or tool execution (e.g., throw from mocked Anthropic client or tool executor).
- **Expected behavior:**
  - Prompt marked with `status = error`, `error` column populated.
  - Assistant placeholder remains `processing` or transitions to `error` depending on handler; queue can resume.
  - Tool call rows record `state = error` with error message.
- **Verification:**
  - DB state reflects failure (prompt error text, tool call error state, conversation still has active prompt nullified or not depending on flow).
  - Logger records error context (optional to assert via spy).

## Notes for Implementation
- Prefer integration tests using the testcontainers-backed Postgres instance to closely match production schema.
- Mock external network dependencies (Anthropic streaming, WebSocket, actual node-pty commands) to keep scenarios deterministic while still touching the database and service orchestration.
- Use factory helpers within tests to seed users/conversations/messages as needed.
- Where async streaming is simulated, ensure React-style `act` or equivalent synchronization so tests do not leave pending promises.
