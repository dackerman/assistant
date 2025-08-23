# Architecture Documentation

## Overview

This application is a real-time conversation streaming web interface for OpenCode, designed to visualize Claude's conversational interactions and debug technical events. It consists of a React frontend and Express backend that communicate via Server-Sent Events (SSE) for real-time data streaming.

## System Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Frontend│    │ Express Backend │    │   OpenCode CLI  │
│   (Port 7653)   │◄──►│   (Port 7654)   │◄──►│   (Port 4096)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
    User Interface          SSE Streaming           AI Processing
    - Main Chat View        - Event Broadcasting    - Session Management
    - Debug Panel          - Message Handling      - Tool Execution
    - Message Input        - Session Creation      - Response Generation
```

## Components Structure

### Frontend (React + TypeScript + Vite)

#### Core Components

- **`App.tsx`** - Main application container with layout and state coordination
- **`ConversationView.tsx`** - User-friendly chat interface displaying messages and tool calls
- **`DebugPane.tsx`** - Technical event stream viewer for debugging
- **`EventRenderer.tsx`** - Individual event display with formatted JSON
- **`MessageInput.tsx`** - Message composition and sending interface

#### Custom Hooks

- **`useConversation.ts`** - Centralized event processing and conversation state management

### Backend (Express + TypeScript)

#### Core Files

- **`src/index.ts`** - Express server with SSE endpoints and OpenCode integration

## Data Flow

### 1. Session Initialization

```typescript
Frontend → POST /api/session → Backend → OpenCode.session.create()
Backend ← Session ID ← OpenCode
Frontend ← Session Response ← Backend
```

### 2. Event Streaming Setup

```typescript
Frontend → GET /events (SSE) → Backend → OpenCode.event.list()
Backend ← Event Stream ← OpenCode
Frontend ← SSE Events ← Backend (continuous)
```

### 3. Message Flow

```typescript
User Input → MessageInput → useConversation.sendMessage()
Frontend → POST /api/message → Backend → OpenCode.session.chat()
Backend ← Response ← OpenCode
Real-time events flow via existing SSE connection
```

## Event Processing

### OpenCode Event Structure

OpenCode events have a nested structure:

```json
{
  "type": "message.part.updated",
  "properties": {
    "part": {
      "id": "prt_...",
      "messageID": "msg_...",
      "type": "text",
      "text": "Assistant response content"
    }
  }
}
```

### Event Types Handled

- **`message.updated`** - Tracks message metadata and roles (user/assistant)
- **`message.part.updated`** - Text content updates for streaming responses
- **`step.started`** - Tool execution begins
- **`step.completed`** - Tool execution finishes
- **`step.error`** - Tool execution fails
- **`message.completed`** - Message streaming ends

### State Management

The `useConversation` hook manages:

- **Messages array** - User and assistant conversation history
- **Tool calls array** - Active and completed tool executions
- **Events array** - Raw technical events for debugging
- **Message roles map** - Tracks which message IDs belong to users vs assistants

## UI Architecture

### Layout Structure

```
App Container
├── Header (stats, debug toggle)
├── Body (flexible layout)
│   ├── Main Pane (ConversationView)
│   └── Debug Pane (optional, DebugPane)
└── Message Input (fixed bottom)
```

### View Modes

1. **Main View Only** - Clean conversation interface
2. **Split View** - Main conversation (60%) + Debug panel (40%)

### Debug Panel Features

- **Collapsible JSON** - Uses `<details>/<summary>` for expandable content
- **Syntax highlighting** - Monospace fonts with proper indentation
- **Event filtering** - Different colors and formatting per event type
- **Scrollable content** - Contained scrolling for long outputs

## Real-Time Processing

### Event Stream Handling

1. Backend connects to OpenCode's event stream
2. Events are broadcasted to all connected frontend clients via SSE
3. Frontend processes events based on type and updates UI accordingly
4. Message role tracking ensures proper conversation flow

### Message State Synchronization

- **Role Detection** - `message.updated` events establish message ownership
- **Content Streaming** - `message.part.updated` events build message content
- **UI Updates** - Real-time text streaming with cursor animations
- **Completion Handling** - `message.completed` finalizes streaming state

## Technical Decisions

### Why Server-Sent Events (SSE)?

- **Simplicity** - Easier than WebSockets for one-way streaming
- **Browser Support** - Native EventSource API
- **Reliability** - Automatic reconnection handling
- **HTTP Compatible** - Works through proxies and firewalls

### Why Separate Frontend/Backend?

- **Development Experience** - Hot reloading and separate concerns
- **Scalability** - Can serve multiple frontend clients
- **Security** - Backend handles OpenCode credentials
- **Flexibility** - Frontend can be deployed separately

### State Management Approach

- **Single Hook** - `useConversation` centralizes all conversation logic
- **Immutable Updates** - React state updates preserve history
- **Event Sourcing** - All state derived from OpenCode events
- **Ref Storage** - Current message tracking for streaming updates

## Development Setup

### Prerequisites

- Node.js 18+
- OpenCode CLI running on port 4096
- pnpm package manager

### Running the Application

```bash
# Install dependencies
pnpm install

# Start both frontend and backend
pnpm run dev

# Or run separately:
pnpm run dev:backend  # Express server (port 7654)
pnpm run dev:frontend # Vite dev server (port 7653)
```

### Build Process

```bash
# Build for production
pnpm run build

# Type checking
pnpm run typecheck
```

## API Endpoints

### Backend REST API

- **`POST /api/session`** - Create new OpenCode session
- **`POST /api/message`** - Send message to current session
- **`GET /health`** - Health check and OpenCode connectivity
- **`GET /events`** - Server-Sent Events stream

### Event Stream Format

```
data: {"type": "message.part.updated", "properties": {...}}

data: {"type": "step.started", "properties": {...}}

data: {"type": "message.completed", "properties": {...}}
```

## Error Handling

### Frontend Error Handling

- **Event Parse Errors** - Logged to console, don't break stream
- **Network Errors** - Automatic SSE reconnection
- **Message Send Failures** - User feedback via console

### Backend Error Handling

- **OpenCode Connection** - Retry logic with exponential backoff
- **Session Management** - Auto-create sessions when needed
- **Event Streaming** - Restart stream on failure

## Performance Considerations

### Frontend Optimizations

- **Event Batching** - Multiple events processed in single render cycle
- **Message Deduplication** - Prevents duplicate message creation
- **Scroll Management** - Auto-scroll to latest messages
- **Debug Panel** - Collapsible content reduces DOM overhead

### Backend Optimizations

- **Session Reuse** - Single session per server instance
- **Event Broadcasting** - Efficient multi-client SSE distribution
- **Memory Management** - No server-side event storage

## Future Enhancements

### Planned Features

- **Message History Persistence** - Store conversations locally
- **Export Functionality** - Download conversations as JSON/text
- **Advanced Filtering** - Filter events by type or content
- **Theme Support** - Light/dark mode toggle
- **Message Search** - Full-text search across conversation history

### Technical Improvements

- **Error Recovery** - Better handling of connection failures
- **Performance Monitoring** - Event processing metrics
- **Testing Suite** - Unit and integration tests
- **Docker Support** - Containerized deployment
