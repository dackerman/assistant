# Refactor Checklist (Internal App)

Backend

- [ ] Encapsulate backend session state in SessionManager (no globals)
- [ ] Scope SSE and actions per-session; pass sessionId to /events
- [ ] Fix SSE lifecycle: prune dead clients, add keepalives, stop when no listeners
- [ ] Remove global isStreamingEvents; track streaming by sessionId with abort/reset
- [ ] Make provider/model configurable via env or request (env: PROVIDER_ID, MODEL_ID)
- [ ] Unify session title source of truth (persist via SDK or frontend-only)
- [x] Change health check to non-creating ping (no side effects)
- [ ] Reduce verbose logging; use leveled logger and redact payloads
- [ ] Document/dev toggle for static serving only in prod
- [x] Treat SDK as source of truth for sessions; drop shadow Map metadata

Frontend (hooks/state/UI)

- [ ] Normalize events into a single timeline in hook; drop imperative refs
- [ ] Add zod schemas for backend events and validate in hook
- [ ] Ensure session before sendMessage; enforce state machine
- [ ] Create unified ordered timeline state; remove per-render sort
- [x] Remove duplicate EventRenderer file and consolidate viewer/debug
- [ ] Use stable keys for events/tool calls/messages
- [ ] Deduplicate session switching calls (only hook triggers API)
- [ ] Model explicit app states (idle/picking/connecting/active)
- [ ] Extract inline styles to CSS/theme; centralize tokens
- [ ] Surface UI error states and retries for SSE/message failures

Build/config/DX

- [ ] Fix tsconfig/package build: separate typecheck and server build; remove noEmit conflict
- [ ] Adjust start script to run built server; add backend bundler or tsc emit
- [ ] Add basic tests for event reducer and session flow; add ESLint
- [ ] CI: run format/lint/typecheck/build + E2E; fix Playwright workflow step indentation
- [ ] Provide .env.example and document required env vars (OPENCODE_URL, PROVIDER_ID, MODEL_ID)

Backend (security/robustness)

- [ ] Restrict CORS in production; configurable allowlist via env
- [ ] Centralize error handling middleware; consistent JSON errors
