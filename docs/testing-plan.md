# Streaming Testing Plan

This plan documents current coverage, spec alignment, gaps, and a pragmatic test strategy to make streaming (backend + frontend) reliable with minimal mocking. It includes a medium‑granularity TODO checklist to get from current state to solid coverage.

## Goals

- Exercise real data flows end‑to‑end where feasible (DB, WS), with minimal mocks.
- Verify streaming correctness: ordering, persistence, state transitions, fan‑out.
- Make reconnection and snapshot behavior robust for clients.
- Keep tests maintainable and not brittle; avoid stubs except for external APIs.

## Current Coverage Snapshot

- Server (Vitest + Testcontainers Postgres):
  - `StreamingStateMachine` tests cover: `block_start`, `block_delta` append, `tool_call` `block_end` record creation, `handleMessageStop` with and without tools, `cancel`, `resume`, `handleError`.
  - `ConversationService` tests cover: create/list/delete, `createUserMessage` flow, `getConversation` for completed messages, `getActiveStream` for non‑finalized blocks, `buildConversationHistory` (text only).
- Web (Vitest + jsdom):
  - `App` render smoke test only.

## Spec vs. Implementation (Key Deltas)

Reference: `docs/streaming_spec.md`.

- REST Endpoints:
  - Spec: `GET /api/conversations/:id/streaming`, `POST /api/prompts/:id/resume`, `POST /api/prompts/:id/cancel`.
  - Impl: `GET /api/conversations/:id/stream` only; no resume/cancel routes.
- WebSocket Events (server → client):
  - Spec: `conversation_history`, `streaming_state`, `stream_event`, `block_update`, `tool_update`, `prompt_state_change`.
  - Impl: `text_delta`, `stream_complete`, `stream_error`, `snapshot`, `subscribed`, `title_generated`.
- Tool Flow:
  - Spec: async tool execution + timeout, WAITING_FOR_TOOLS handling, continue streaming results.
  - Impl: records tool_call at `block_end`; WAITING_FOR_TOOLS exists, but no execution/timeout engine or continue.
- Cleanup:
  - Spec: finalize blocks, clear `active_prompt_id`, prune events.
  - Impl: finalizes blocks and message on complete; does not clear `conversations.activePromptId`; no event pruning.
- Resume/Cancel:
  - Spec: dedicated endpoints.
  - Impl: `StreamingStateMachine.resume()` / `cancel()` exist but not exposed as routes.

These differences are acceptable if intentional; tests will reflect current behavior while calling out gaps.

## Risks & Gaps

- No backend streaming E2E (WS) tests with real DB + broadcast fan‑out + persistence checks.
- No mid‑stream subscribe snapshot test.
- No stream error broadcast test.
- No unsupported model path test.
- State machine assertions missing for:
  - `block_start` → prompt `state=IN_PROGRESS` + `currentBlock` updated.
  - `completePrompt` → blocks linked to message + `isFinalized=true` (only partially covered).
  - WAITING_FOR_TOOLS → assistant message remains incomplete.
  - `resume()` complete set of cases (CREATED/FAILED, WAITING with running tools).
- Conversation lifecycle: `activePromptId` not cleared on complete (spec suggests clearing).
- Web tests missing for `useWebSocket` (connect, reconnect/backoff, snapshot, state toggling) and `ConversationView` streaming/restore behavior.
- No contract tests for Anthropic stream event stub fidelity.

## Proposed Test Strategy

Prioritize high signal, minimal brittle points.

### Server: State Machine Enhancements

- Assert on `block_start`:
  - `prompts.state` becomes `IN_PROGRESS` and `currentBlock` equals `blockIndex`.
- End‑to‑end finalization (no tools):
  - Sequence: `block_start(0)` → `block_delta` (text) → `handleMessageStop()`.
  - Verify: one text block with `messageId` set, `isFinalized=true`; assistant message `isComplete=true`.
- WAITING_FOR_TOOLS path:
  - With a `created` or `running` tool call, `handleMessageStop()` → prompt `WAITING_FOR_TOOLS` and assistant message remains `isComplete=false`.
- `resume()` cases:
  - `CREATED` and `FAILED` → `{ status: 'retry_from_start' }` and prompt `state=IN_PROGRESS`.
  - `WAITING_FOR_TOOLS` with a running tool → `{ status: 'waiting_for_tools' }`.

### Server: Streaming E2E over WebSocket (minimal external stub)

- Start HTTP+WS server with Anthropic client mocked to an async iterator producing realistic events.
- Scenarios:
  - Happy path: `message_start` → `content_block_delta(text)` × N → `message_stop`.
    - Expect deltas broadcast in order to all subscribers; stream_complete at end.
    - DB: events persisted, final content in blocks, prompt `COMPLETED`, assistant message `isComplete=true`.
  - Mid‑stream subscription:
    - Subscriber B connects after some deltas; receives `snapshot` with joined text; both A and B receive subsequent deltas.
  - Stream error:
    - Throw mid‑stream; expect prompt state `ERROR` and `stream_error` broadcast with message.
  - Unsupported model:
    - `send_message` with invalid model → WS error payload; no prompt created.

Implementation note: Prefer dependency injection (DI) for Anthropic client or Vitest module mock for `@anthropic-ai/sdk`.

### Web: `useWebSocket` Integration (real WS server in tests)

- Provide a test `ws` server bound to `ws://localhost:4001` that emits server messages.
- Tests:
  - Connect → `isConnected=true` and server receives subscription when invoked.
  - `text_delta` → callback invoked, `isStreaming=true`.
  - `stream_complete` → callback invoked, `isStreaming=false`.
  - `stream_error` → callback invoked, `isStreaming=false`.
  - `snapshot` → callback invoked and `isStreaming` reflects `IN_PROGRESS`/`WAITING_FOR_TOOLS`.
  - Reconnect/backoff:
    - Non‑1000 close triggers reconnect after ~3s and resubscribe message.
    - Clean 1000 close does not auto‑reconnect.
  - Idempotent connect: guard prevents parallel connection attempts.

### Web: `ConversationView` Behavior

- Stub only HTTP fetch calls (not WS):
  - `getConversation` returns one user and one assistant complete message.
  - `getActiveStream` returns an active prompt with non‑finalized text blocks.
- Tests:
  - Loading a conversation merges text blocks into message content.
  - Restoring active stream updates/creates assistant message content.
  - Snapshot after deltas overwrites content correctly and preserves timestamp if present.
  - UI state: “AI is typing…” reflects `isStreaming`; input/button disabled when streaming.
  - Title updates via `title_generated` handler trigger parent `onTitleUpdate`.

### Contract Tests for Anthropic Stub

- Validate stub event shapes against a local schema (e.g., Zod) for the specific fields we consume:
  - `message_start`, `content_block_start`, `content_block_delta` with `{ delta: { type: 'text_delta', text } }`, `content_block_stop`, `message_stop`.
- Ensures stub fidelity to production SDK events we rely on.

### Optional but Valuable

- REST routes for resume/cancel:
  - `POST /api/prompts/:id/resume` → `StreamingStateMachine.resume()`.
  - `POST /api/prompts/:id/cancel` → `StreamingStateMachine.cancel()`.
- Clear `conversations.activePromptId` on completion (spec‑aligned) and test it.
- WS protocol alignment/compatibility layer for spec event names (e.g., support both `snapshot` and `streaming_state`).
- Event pruning job (post‑completion) with basic coverage.

## Test Infrastructure & Setup

### Server (apps/server)

- Uses Vitest. DB tests gated by `RUN_DB_TESTS=1`; Testcontainers Postgres boots in `src/test/setup.ts`.
- Requirements:
  - Docker available locally/CI.
  - Increase `testTimeout`/`hookTimeout` (already 30s) if E2E start/stop adds latency.
- Anthropic client:
  - Introduce DI for the client used by `startAnthropicStream`, or use Vitest `vi.mock('@anthropic-ai/sdk')` to return an async iterator that yields realistic events.
- Server bootstrap for tests:
  - Export a factory that creates and starts the Hono app + Node HTTP + WSS, with explicit `listen(port)` and `close()` for teardown, rather than side‑effect startup.
  - Allow binding to a test port via `PORT` env.

### Web (apps/web)

- Vitest with jsdom; `@/` alias configured.
- WebSocket in jsdom:
  - Provide a `ws` server (`ws` package) bound to `ws://localhost:4001` in tests.
  - Polyfill `globalThis.WebSocket = require('ws')` for the test runtime to reuse the Node client implementation (only within tests). This enables the hook’s `new WebSocket('ws://host:4001')` to function.
  - Ensure to `close()` sockets and server in `afterEach/afterAll` to avoid port leaks.
- For fetch stubs:
  - Use `vi.spyOn(global, 'fetch')` to stub only the HTTP endpoints used by `ConversationView` tests.

## File Layout Suggestions

- Server tests:
  - Extend: `apps/server/src/streaming/stateMachine.test.ts` (additional assertions listed above)
  - New: `apps/server/src/streaming/streaming.e2e.test.ts` (WS + Anthropic stub)
  - Support: `apps/server/src/test/anthropicStub.ts`, `apps/server/src/test/anthropicEventSchema.ts`
- Web tests:
  - New: `apps/web/src/hooks/useWebSocket.test.ts`
  - New: `apps/web/src/components/chat/ConversationView.test.tsx`

## How to Run

- Server tests with DB (Docker required):
  - `RUN_DB_TESTS=1 pnpm run test --filter=apps/server`
- Web tests:
  - `pnpm run test --filter=apps/web`
- Monorepo:
  - `pnpm run test` (will skip server DB tests unless `RUN_DB_TESTS=1`)

## TODO Checklist

Prep & Infra

- [ ] Server bootstrap factory: export `createAppServer()` returning `{ server, wss, close }` for tests.
- [ ] Inject Anthropic client into `startAnthropicStream` (constructor/factory param) or provide Vitest mock boundary.
- [ ] Add Anthropic stream stub that yields realistic async iterator events.
- [ ] Add Zod schemas for consumed Anthropic events; validate stub against them.
- [ ] Web test WS infra: add `ws` server helper and `global.WebSocket` polyfill for tests.
- [ ] Ensure deterministic timers (Vitest fake timers) around reconnect backoff tests.

Server: State Machine Tests

- [ ] Assert `block_start` sets prompt `state=IN_PROGRESS` and `currentBlock`.
- [ ] Finalization path (no tools): blocks linked to message, `isFinalized=true`, assistant message `isComplete=true`.
- [ ] WAITING_FOR_TOOLS keeps assistant message incomplete.
- [ ] `resume()` CREATED/FAILED → `retry_from_start` and state set to `IN_PROGRESS`.
- [ ] `resume()` WAITING_FOR_TOOLS with running tool → `waiting_for_tools`.

Server: Streaming E2E (WS)

- [ ] Happy path: deltas broadcast in order, stream_complete at end, DB finalized.
- [ ] Mid‑stream subscriber receives snapshot and subsequent deltas.
- [ ] Error path: prompt state `ERROR`, `stream_error` broadcast.
- [ ] Unsupported model emits WS error; no prompt created.

Web: `useWebSocket` Tests

- [ ] Connect/subscribed lifecycle and `isConnected`.
- [ ] `text_delta` toggles `isStreaming` true and invokes callback.
- [ ] `stream_complete`/`stream_error` toggle `isStreaming` false and invoke callbacks.
- [ ] `snapshot` invokes callback and sets `isStreaming` based on state.
- [ ] Reconnect/backoff: non‑1000 close → reconnect + resubscribe; 1000 close → no reconnect.
- [ ] Guard against parallel connects.

Web: `ConversationView` Tests

- [ ] Loads conversation and merges text blocks into content.
- [ ] Restores active stream into assistant message content.
- [ ] Snapshot merge behavior preserves timestamps when updating content.
- [ ] UI state reflects streaming (typing indicator, input/button disabled).
- [ ] Title updates fire `onTitleUpdate`.

Optional Enhancements (spec alignment)

- [ ] Add REST: `POST /api/prompts/:id/resume` and `POST /api/prompts/:id/cancel`; add tests.
- [ ] Clear `conversations.activePromptId` on prompt completion; add test.
- [ ] WS protocol compatibility with spec event names; add tests for both names.
- [ ] Event pruning job after completion; add a basic test around retention policy.

---

If you’d like, I can start by wiring the server bootstrap + Anthropic DI, then land the first set of state machine test assertions and the `useWebSocket` integration tests.
