# Streaming Architecture Refactor Plan

## Overview
Refactor the server to use ConversationService as the main orchestrator, with a simplified schema and cleaner streaming architecture.

## Core Principles
1. **ConversationService is the single entry point** - All API requests go through ConversationService
2. **REST for mutations, WebSocket for streaming** - Clear separation of concerns
3. **Conversation-centric WebSocket** - Clients connect to conversations, not individual prompts
4. **Blocks for content structure** - Assistant messages contain different types of content blocks
5. **Simplified schema** - Only tables we actually need, no unnecessary complexity

## Database Schema

### Final Schema Design
```sql
-- Core conversation tracking
conversations (
  id, userId, title, createdAt, updatedAt
)

-- Messages in conversation (both user and assistant)
messages (
  id, conversationId, role, content, status, queueOrder, createdAt
  -- status: 'pending' | 'queued' | 'processing' | 'completed' | 'error'
  -- queueOrder: for managing message queue
)

-- Content blocks within messages (mainly for assistant messages)
blocks (
  id, messageId, type, content, order, metadata, createdAt, updatedAt
  -- type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'code' | 'error'
  -- metadata: JSON for tool details, language for code blocks, etc.
)

-- Prompts sent to LLM
prompts (
  id, conversationId, messageId, status, model, createdAt, completedAt
  -- status: 'pending' | 'streaming' | 'completed' | 'error'
)

-- Raw streaming events from LLM (for recovery/debugging)
promptEvents (
  id, promptId, type, data, createdAt
  -- Store raw Anthropic streaming events
)

-- Tool execution tracking
toolCalls (
  id, promptId, blockId, name, input, output, status, pid, createdAt, completedAt
  -- blockId: links to the tool_use block that displays it
  -- pid: process ID for bash sessions
  -- status: 'pending' | 'executing' | 'completed' | 'error' | 'timeout'
)
```

### Tables to Remove
- Any commented out schema in `schema.ts`
- Remove complex relationships that aren't needed

## Architecture

### Data Flow
```
1. User sends POST /api/conversations/:id/messages
   ↓
2. ConversationService.queueMessage()
   - Creates message with status='queued'
   - If no active prompt, starts processing
   ↓
3. ConversationService.processQueue()
   - Gets next queued message
   - Creates assistant message (status='processing')
   - Calls PromptService.createAndStream()
   ↓
4. PromptService.createAndStream()
   - Creates prompt record
   - Builds conversation history
   - Streams to Anthropic
   - For each streaming event:
     - Creates/updates blocks in assistant message
     - Broadcasts to WebSocket clients
     - Executes tools via ToolExecutorService
   ↓
5. WebSocket broadcasts to all clients watching conversation
   - Sends block updates in real-time
   - Sends tool execution progress
   ↓
6. On completion:
   - Updates message status='completed'
   - Processes next queued message if any
```

### Service Responsibilities

#### ConversationService
- Message queue management
- Message and block CRUD
- Orchestrates PromptService
- Manages conversation state
- Handles WebSocket snapshot/subscription

#### PromptService  
- Creates prompts from messages
- Handles Anthropic streaming
- Creates/updates blocks as content streams
- Delegates tool execution to ToolExecutorService
- Saves streaming events for recovery

#### ToolExecutorService
- Executes tools (currently just bash)
- Manages BashSession instances via SessionManager
- Streams tool output to blocks
- Handles timeouts and errors

#### SessionManager (to be created)
- Manages BashSession lifecycle
- One session per conversation
- Handles cleanup on conversation end

## Implementation Steps

### Phase 1: Schema Cleanup
1. Clean up `schema.ts` - remove commented code, implement final schema
2. Run migrations to update database
3. Update all type definitions

### Phase 2: Core Service Updates
1. **ConversationService refactor**:
   - Remove references to old schema
   - Add message queue methods
   - Add block management
   - Integrate PromptService calls
   - Add WebSocket snapshot generation

2. **Create SessionManager**:
   - Simple class to manage BashSession instances
   - Methods: getSession(conversationId), destroySession(conversationId)

3. **Update PromptService**:
   - Remove standalone usage, make it ConversationService-internal
   - Update to create/update blocks during streaming
   - Fix tool execution integration

4. **Update ToolExecutorService**:
   - Use SessionManager instead of inline session management
   - Update database queries for new schema
   - Fix streaming callbacks to update blocks

### Phase 3: WebSocket Refactor
1. **Remove StreamingStateMachine** (probably not needed)
2. **Update WebSocket handler**:
   - Change from prompt-specific to conversation-specific connections
   - On connect: send conversation snapshot
   - During streaming: forward block updates
   - Support multiple clients per conversation

### Phase 4: API Updates
1. **Update message endpoints**:
   - POST `/api/conversations/:id/messages` - queues message
   - GET `/api/conversations/:id/messages` - includes queued messages
   - PATCH `/api/conversations/:id/messages/:id` - edit queued only
   - DELETE `/api/conversations/:id/messages/:id` - delete queued only

2. **Add queue control**:
   - POST `/api/conversations/:id/process` - start processing queue
   - POST `/api/conversations/:id/clear-queue` - remove all queued messages

### Phase 5: Cleanup
1. Remove dead code:
   - StreamingStateMachine (if not needed)
   - Old schema references
   - Unused imports and types

2. Fix all TypeScript errors:
   - Update imports
   - Fix type mismatches
   - Ensure all services use new schema

3. Add basic error handling:
   - Database transaction rollbacks
   - Proper error messages to clients
   - Cleanup on failures

## Success Criteria
- [ ] Project compiles without errors
- [ ] No dead code or commented schemas
- [ ] Can create conversation and send messages
- [ ] Messages queue properly
- [ ] Assistant responses stream via WebSocket
- [ ] Tool execution works and streams output
- [ ] Multiple clients can watch same conversation
- [ ] Queued messages can be edited/deleted

## Testing Plan
1. Start development database
2. Run migrations
3. Start server
4. Connect WebSocket client
5. Send message via REST API
6. Verify streaming response
7. Queue multiple messages
8. Test tool execution
9. Test multi-client streaming

## Notes
- Keep the implementation simple initially - we can add optimizations later
- Focus on getting the core flow working end-to-end
- Use transactions where needed for data consistency
- Log extensively during development for debugging