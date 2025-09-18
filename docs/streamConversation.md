# Consuming `ConversationService.streamConversation`

This guide explains how a client (typically the web app) should consume
`ConversationService.streamConversation` to render and keep a conversation view
up to date.

## High-level flow

1. Call `ConversationService.streamConversation(conversationId, userId)`.
   - The method returns a snapshot representing the persisted state *plus*
     `events`, an async iterator that yields real-time updates.
2. Use the snapshot to build your initial in-memory model.
3. Listen to `events` and incrementally apply each update to the view.
4. Stop iteration when the UI unsubscribes (e.g. component unmount) and call the
   iterator's `return()` to tidy up the server listener.

## Snapshot semantics

The snapshot contains:

- `conversation`: metadata (title, active prompt, timestamps).
- `messages`: every message (user + assistant) with their persisted blocks.
  - User messages are always completed because they first persist blocks before
    streaming begins.
  - Assistant messages may be `processing` when streaming is active.
  - **Important:** assistant blocks that are still streaming are omitted from the
    snapshot. They arrive exclusively through replay events (see below).

Implications for the client:

- Render the snapshot as-is; completed blocks are final.
- For an active assistant message, expect fresh blocks to come via events.
- If you re-render after reconnecting, reconcile the snapshot first, then replay
  incoming events (the combination yields the full state).

## Event stream semantics

The `events` async iterator emits objects with a `type` key. Clients should
pattern-match on `type` and update local state. Ordering matches creation order
in the service, so applying in sequence keeps the state consistent.

### Message lifecycle events

| Event type          | Payload fields        | Usage                             |
|---------------------|-----------------------|-----------------------------------|
| `message-created`   | `message`             | Insert a placeholder message.     |
| `message-updated`   | `message`             | Replace message fields by ID.     |
| `prompt-started`    | `prompt`              | Mark assistant message as active. |
| `prompt-completed`  | `prompt`              | Mark assistant message finished.  |
| `prompt-failed`     | `prompt`, `error?`    | Transition message to error view. |

Message events precede block events for the same prompt, so the client can
prepare structures before blocks arrive.

### Block streaming events

| Event type      | Additional data                             | Notes |
|-----------------|---------------------------------------------|-------|
| `block-start`   | `promptId`, `messageId`, `blockId`, `blockType` | Create a new block shell. For `tool_use` blocks, expect tool events later. |
| `block-delta`   | `promptId`, `messageId`, `blockId`, `content` | Append delta text. Deltas are UTF-8 text; concatenate to produce the visible content. |
| `block-end`     | `promptId`, `messageId`, `blockId` | Marks the block as complete. `tool_use` blocks often transition to a `tool_result` block later. |

Because the snapshot omits in-flight blocks, the server replays the latest
state of each streaming block to the new subscriber. The sequence is always: a
single `block-start`, followed by zero or more `block-delta` chunks, then (later)
`block-end`. Deltas may arrive even after a reconnect; clients must treat
updates as cumulative and idempotent (append based on `blockId`).

### Tool execution events

| Event type             | Payload fields                                     | Client handling |
|------------------------|----------------------------------------------------|-----------------|
| `tool-call-started`    | `toolCall`, `input`                                | Show tool execution panel, capture input metadata. |
| `tool-call-progress`   | `toolCallId`, `blockId`, `output`                  | Append incremental tool output (if rendering live logs). |
| `tool-call-completed`  | `toolCall`                                         | Replace or mark result block as finalized. |
| `tool-call-failed`     | `toolCall`, `error`                                | Display failure state, stop spinners. |

When a reconnect happens mid-execution, the server keeps the persisted output in
`toolCall.output`. The replayed `block-delta` plus subsequent `tool-call-*`
progress events rehydrate the current terminal output, so continue appending
using the last known substring length.

## Recommended client state model

Maintain a dictionary keyed by message ID containing:

- Scalar message fields (status, timestamps, etc.).
- An ordered list of block objects keyed by `blockId`.
- For each block: `type`, accumulated `content`, metadata, completion flag.

When applying events:

1. `message-created`: insert or replace message entry.
2. `message-updated`: merge fields by ID.
3. `block-start`: append new block placeholder with empty content.
4. `block-delta`: concatenate `content` to the block's text buffer.
5. `block-end`: set completion flag; keep `content` untouched.
6. Tool events: update related block metadata and tool call panels.

This structure makes it easy to render messages with React keyed by `messageId`
and `blockId` while supporting streaming updates.

## Reconnection workflow

To support tab refreshes or transient websocket drops:

1. Call `streamConversation` again.
2. Replace local state using the new snapshot (preserving UI references like
   scroll if needed).
3. Resume applying events as before.

Because the snapshot excludes in-flight blocks, you will not duplicate text when
replaying—the replay events always start from the first unseen character.

If you maintain optimistic local edits (e.g., while sending a user message),
ensure you reconcile them with the snapshot so that persisted IDs replace
client-generated placeholders once the server acknowledges creation.

## Cleanup

When the UI no longer needs updates, ensure the async iterator is closed:

```ts
const stream = await conversationService.streamConversation(id, userId)
const iterator = stream.events[Symbol.asyncIterator]()

try {
  while (true) {
    const { value, done } = await iterator.next()
    if (done) break
    applyEvent(value)
  }
} finally {
  await iterator.return?.(undefined) // releases DB listener on the server
}
```

Failing to close gracefully leaves the server channel active until the backend
notices a broken connection.

## Debugging tips

- Log event types with IDs when developing to verify the client applies them in
  order.
- If you observe duplicated text, ensure you are concatenating by `blockId` and
  not re-initializing state on every delta.
- Tool outputs come through both block deltas and tool progress events;
  deduplicate by tracking the current length of each block's `content` buffer.

By following this contract the frontend can deliver a resilient conversation
experience with instant reconnects and accurate tool state.
