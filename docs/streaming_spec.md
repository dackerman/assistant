# Streaming Architecture Specification

## Overview

This document specifies a robust streaming system for AI conversations with support for:

- Real-time streaming of AI responses
- Interleaved content blocks (text, thinking, tool calls)
- Async tool execution with timeout handling
- Seamless client reconnection
- Message persistence and conversation history

## Core Concepts

### 1. Data Model Hierarchy

```
Users
 └── Conversations
      └── Messages (user/assistant/system)
           └── Blocks (text/thinking/tool_call/attachment)
                └── Tool Calls (for tool_call blocks)
                └── Attachments (for attachment blocks)
```

### 2. Prompt States

A prompt represents an AI completion request and progresses through these states:

- **CREATED**: Initial state, ready to send to AI
- **IN_PROGRESS**: Actively streaming from AI
- **WAITING_FOR_TOOLS**: Paused, waiting for tool executions to complete
- **COMPLETED**: Successfully finished
- **FAILED**: API connection/send failure
- **ERROR**: Stream error during processing (recoverable)
- **CANCELED**: Manually canceled by user

### 3. Block Types

Messages are composed of ordered blocks:

- **text**: Regular AI response text
- **thinking**: AI reasoning/thought process (hidden or styled differently)
- **tool_call**: Tool invocation with parameters and results
- **attachment**: File attachments (user messages only)

## Implementation Flows

### Starting a New Conversation

```typescript
// 1. User sends a message
POST /api/conversations/{id}/messages
{
  "role": "user",
  "blocks": [
    { "type": "text", "content": "Analyze this data" },
    { "type": "attachment", "metadata": { "file_name": "data.csv", ... } }
  ]
}

// 2. Server creates prompt and starts streaming
async function handleUserMessage(conversationId, userMessage) {
  // Create user message with blocks
  const message = await createMessage(conversationId, 'user', userMessage.blocks);

  // Create assistant message placeholder
  const assistantMessage = await createMessage(conversationId, 'assistant');

  // Create prompt
  const prompt = await createPrompt({
    conversation_id: conversationId,
    message_id: assistantMessage.id,
    state: 'CREATED',
    model: selectedModel,
    system_message: buildSystemPrompt()
  });

  // Start streaming from AI
  startStreaming(prompt);
}
```

### Stream Processing

```typescript
async function processStreamEvent(prompt, event) {
  await db.transaction(async trx => {
    // 1. Store raw event
    await trx.insertEvent({
      prompt_id: prompt.id,
      index_num: nextIndex,
      type: event.type,
      block_type: event.block_type,
      block_index: event.block_index,
      delta: event.delta,
    })

    // 2. Process based on event type
    switch (event.type) {
      case 'block_start':
        const block = await trx.insertBlock({
          prompt_id: prompt.id,
          type: event.block_type,
          index_num: event.block_index,
          content: '',
        })
        await trx.updatePrompt(prompt.id, { current_block: event.block_index })
        break

      case 'block_delta':
        await trx.appendToBlock(prompt.id, event.block_index, event.delta)
        break

      case 'block_end':
        if (event.block_type === 'tool_call') {
          const block = await trx.getBlock(prompt.id, event.block_index)
          await createToolCall({
            prompt_id: prompt.id,
            block_id: block.id,
            api_tool_call_id: event.tool_call_id,
            tool_name: event.tool_name,
            request: event.tool_parameters,
            state: 'created',
          })
          // Start async tool execution
          executeToolAsync(toolCall)
        }
        break
    }
  })

  // 3. Forward to connected clients
  broadcastToClients(prompt.conversation_id, event)
}
```

### Tool Execution Flow

```typescript
async function handleMessageStop(prompt) {
  const pendingTools = await getToolCalls(prompt.id, ['created', 'running'])

  if (pendingTools.length > 0) {
    // Transition to waiting state
    await updatePrompt(prompt.id, { state: 'WAITING_FOR_TOOLS' })

    // Wait for tools to complete (with timeout)
    const results = await waitForToolCompletion(prompt.id, {
      timeout: 60000, // 1 minute
      onTimeout: async toolCall => {
        await updateToolCall(toolCall.id, {
          state: 'canceled',
          error: 'Timeout after 1 minute',
        })
      },
    })

    if (allToolsComplete(results)) {
      // Send results back to AI
      await updatePrompt(prompt.id, { state: 'IN_PROGRESS' })
      continueStreaming(prompt, results)
    } else {
      // Some tools failed/timed out
      await updatePrompt(prompt.id, {
        state: 'ERROR',
        error: 'Tool execution failed',
      })
    }
  } else {
    // No tools, complete normally
    await completePrompt(prompt)
  }
}

async function completePrompt(prompt) {
  // 1. Transition prompt to completed
  await updatePrompt(prompt.id, { state: 'COMPLETED' })

  // 2. Finalize blocks - link to message
  await db.query(
    `
    UPDATE blocks 
    SET message_id = $1, is_finalized = true
    WHERE prompt_id = $2
  `,
    [prompt.message_id, prompt.id]
  )

  // 3. Mark message as complete
  await updateMessage(prompt.message_id, { is_complete: true })

  // 4. Update conversation
  await updateConversation(prompt.conversation_id, {
    active_prompt_id: null,
    updated_at: new Date(),
  })

  // 5. Cleanup events (optional, can be done async)
  scheduleEventCleanup(prompt.id)
}
```

### Client Connection/Reconnection

```typescript
// Client connects to a conversation
async function connectToConversation(conversationId: string, clientId: string) {
  // 1. Get completed messages with blocks
  const messages = await db.query(
    `
    SELECT m.*, b.*
    FROM messages m
    LEFT JOIN blocks b ON m.id = b.message_id
    WHERE m.conversation_id = $1 AND m.is_complete = true
    ORDER BY m.created_at, b.index_num
  `,
    [conversationId]
  )

  // 2. Send message history
  sendToClient(clientId, {
    type: 'conversation_history',
    messages: formatMessages(messages),
  })

  // 3. Check for active streaming
  const activePrompt = await db.query(
    `
    SELECT * FROM prompts 
    WHERE conversation_id = $1 
    AND state IN ('IN_PROGRESS', 'WAITING_FOR_TOOLS')
  `,
    [conversationId]
  )

  if (activePrompt) {
    // 4. Send current streaming state
    const streamingBlocks = await db.query(
      `
      SELECT b.*, tc.*
      FROM blocks b
      LEFT JOIN tool_calls tc ON b.id = tc.block_id
      WHERE b.prompt_id = $1 AND b.message_id IS NULL
      ORDER BY b.index_num
    `,
      [activePrompt.id]
    )

    sendToClient(clientId, {
      type: 'streaming_state',
      prompt: activePrompt,
      blocks: streamingBlocks,
    })

    // 5. Subscribe to live updates
    subscribeClient(clientId, conversationId)
  }
}
```

### Resume from Error

```typescript
async function resumePrompt(promptId) {
  const prompt = await getPrompt(promptId)

  switch (prompt.state) {
    case 'COMPLETED':
      return { status: 'already_complete' }

    case 'FAILED':
    case 'CREATED':
      // Retry from beginning
      return startStreaming(prompt)

    case 'ERROR':
      // Resume with partial content
      const blocks = await getBlocks(prompt.id)
      const partialMessage = buildPartialMessage(blocks)
      return continueStreaming(prompt, partialMessage)

    case 'WAITING_FOR_TOOLS':
      // Check tool status
      const tools = await getToolCalls(prompt.id)
      if (allComplete(tools)) {
        return continueStreaming(prompt, tools)
      } else {
        return { status: 'waiting_for_tools', tools }
      }

    case 'CANCELED':
      return { status: 'canceled' }
  }
}
```

### Cancel Stream

```typescript
async function cancelStream(promptId) {
  const prompt = await getPrompt(promptId)

  if (prompt.state === 'IN_PROGRESS' || prompt.state === 'WAITING_FOR_TOOLS') {
    // Cancel running tools
    await db.query(
      `
      UPDATE tool_calls 
      SET state = 'canceled', updated_at = NOW()
      WHERE prompt_id = $1 AND state IN ('created', 'running')
    `,
      [promptId]
    )

    // Kill background jobs
    await cancelBackgroundJobs(promptId)

    // Close AI stream if active
    closeAIStream(promptId)
  }

  // Update prompt state
  await updatePrompt(promptId, { state: 'CANCELED' })
}
```

## API Endpoints

### REST Endpoints

```
POST   /api/conversations                    - Create conversation
GET    /api/conversations/:id                - Get conversation with messages
POST   /api/conversations/:id/messages       - Send message
GET    /api/conversations/:id/streaming      - Get current streaming state
POST   /api/prompts/:id/resume              - Resume failed/errored prompt
POST   /api/prompts/:id/cancel              - Cancel active prompt
```

### WebSocket Events

#### Client → Server

```typescript
{ type: 'subscribe', conversationId: string }
{ type: 'unsubscribe', conversationId: string }
{ type: 'send_message', conversationId: string, message: {...} }
{ type: 'cancel_stream', promptId: string }
```

#### Server → Client

```typescript
{ type: 'conversation_history', messages: Message[] }
{ type: 'streaming_state', prompt: Prompt, blocks: Block[] }
{ type: 'stream_event', event: StreamEvent }
{ type: 'block_update', blockId: string, content: string }
{ type: 'tool_update', toolCallId: string, state: string, result?: any }
{ type: 'prompt_state_change', promptId: string, state: string }
{ type: 'error', message: string }
```

## Data Cleanup Strategy

### Event Pruning

- Events can be deleted after prompt reaches COMPLETED/FAILED/CANCELED
- Keep events for ERROR state (needed for resume)
- Implement async cleanup job running every hour

### Block Finalization

- When prompt completes, blocks are linked to message (message_id set)
- Finalized blocks are permanent part of conversation history
- Non-finalized blocks from failed prompts can be cleaned up

### Tool Call Archival

- Completed tool calls can be summarized after 24 hours
- Keep tool_name, state, and summary; archive full request/response

## Error Handling

### Network Failures

- Client disconnection: No action needed, client will reconnect
- AI API connection failure: Set prompt to FAILED, allow retry
- Database connection failure: Circuit breaker, queue operations

### Tool Failures

- Individual tool timeout: Mark as canceled after 1 minute
- Tool execution error: Store error, continue with other tools
- All tools failed: Transition prompt to ERROR

### State Inconsistencies

- Add validation before state transitions
- Use database transactions for all multi-step operations
- Implement state machine constraints in database

## Performance Optimizations

### Database

- Partial indexes for active prompts only
- Materialized view for conversation summaries
- Connection pooling with read replicas for queries

### Streaming

- Batch events before writing to database (every 100ms)
- Compress WebSocket messages for large responses
- Use Server-Sent Events as fallback for WebSocket issues

### Caching

- Cache completed messages in Redis
- Cache user's active conversations list
- Invalidate cache on message updates

## Security Considerations

### Input Validation

- Sanitize all user inputs before storing
- Validate file uploads (type, size, content)
- Rate limit message sending per user

### Tool Execution

- Sandbox tool execution environment
- Validate tool parameters against schema
- Audit log all tool executions

### Data Access

- Row-level security for conversations
- Verify user owns conversation before operations
- Encrypt sensitive data at rest

## Monitoring & Metrics

### Key Metrics

- Prompt state distribution
- Average streaming duration
- Tool execution success rate
- Client reconnection frequency
- Event processing latency

### Alerts

- Prompts stuck in WAITING_FOR_TOOLS > 2 minutes
- High rate of ERROR states
- Database transaction failures
- WebSocket connection drops

### Logging

- Structured logging with correlation IDs
- Log state transitions with context
- Debug logging for development only
