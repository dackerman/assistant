# Conversation Architecture Fix Plan

## Why we need this
The current server implementation diverges from the documented design in several critical areas:
- the streaming pipeline never transitions queued messages to `completed`, so conversation queues jam after the first prompt and history building ignores the newest user turn
- two different history builders drift in behaviour, leaving prompts without the most recent context
- WebSocket broadcasting, test fixtures, and docs all reference legacy structures or fields that the new schema removed
- the entry point still constructs redundant Anthropic and tool executor instances, while the ORM schema keeps unused columns and enum variants

This plan sequences the code and documentation fixes so that we stabilise the runtime behaviour first, then collapse duplication, and finally prune cruft.

## Step-by-step approach

### 1. Restore prompt completion flow
1. Wire `PromptService.createAndStreamPrompt` so it signals completion/failure back to `ConversationService` (e.g. accept callbacks or emit events).
2. Update `ConversationService.processQueue` to mark the user message `completed` (or a dedicated status) once the text block persists so history can include it.
3. Ensure `ConversationService.completeMessage` (or an equivalent helper) runs automatically after prompts finish and clears `activePromptId`.
4. Add error-path handling so failed prompts reset message status and optionally requeue.

### 2. Unify conversation history construction
1. Extract a shared helper (e.g. `conversationHistory.ts`) that composes Anthropic-ready history from completed messages/blocks.
2. Replace both `ConversationService.buildConversationHistory` and `PromptService.buildConversationHistory` with the shared helper.
3. Guarantee the helper includes the active user message that just entered `processing`, so prompts receive the latest turn.

### 3. Align runtime state with schema
1. Remove unused enum variants and columns (`conversations.activePromptId`, message status values never set, etc.) from Drizzle schema and migrations.
2. Add any missing columns required by the new flow (e.g. explicit `completedAt` timestamps if referenced).
3. Regenerate types and run migrations.

### 4. Finish WebSocket integration
1. Hook `PromptService` streaming callbacks so block deltas/tool events broadcast via the existing WebSocket registry.
2. Decide whether to broadcast through `ConversationService` or a small pub/sub utility and implement accordingly.
3. Extend snapshot payloads to include the same structure the streaming deltas use.

### 5. Clean the entry point and service wiring
1. Remove the unused `Anthropic` instance and only instantiate the client inside `PromptService`.
2. Delete the duplicate `ToolExecutorService` created in `index.ts`; reuse the instance owned by `PromptService` or inject one explicitly.
3. Confirm dependency injection strategy (constructor params vs. lazy singletons) and adjust tests accordingly.

### 6. Reconcile tests with the new behaviour
1. Rewrite `ConversationService` and `PromptService` Vitest suites so they target the updated schema and streaming flow.
2. Stub Anthropic/tool execution through the new callback wiring.
3. Add coverage for queue progression, multi-turn history, and tool result propagation.

### 7. Prune stale docs and comments
1. Update `docs/streaming_spec.md` and `apps/server/docs/streaming_refactor_plan.md` to match the implemented flow or clearly mark legacy assumptions.
2. Remove inline comments that refer to now-deleted schema fields (e.g. `isFinalized`).

## Checklist
- [x] Hook prompt completion events back into `ConversationService` so message statuses advance correctly
- [x] Update queue processing to include the latest user message in prompt history
- [ ] Extract a shared conversation history helper and remove duplicate implementations
- [ ] Trim unused schema columns/enums and regenerate migrations
- [ ] Broadcast streaming deltas/tool updates over WebSocket
- [ ] Remove redundant Anthropic/tool executor instantiations in `index.ts`
- [ ] Rewrite backend Vitest suites against the new schema and flow
- [ ] Refresh the streaming docs to describe the final architecture
