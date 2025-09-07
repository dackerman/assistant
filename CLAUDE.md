# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack TypeScript application with a Turbo monorepo structure:

- **Frontend**: React + Vite + Tailwind CSS + ShadCN/ui (`apps/web`)
- **Backend**: Node.js + Hono + WebSockets + Drizzle ORM (`apps/server`)
- **Database**: PostgreSQL with complex conversation/streaming architecture
- **Build system**: Turbo for monorepo orchestration

## Essential Commands

### Development

```bash
# Install dependencies (uses pnpm as package manager)
pnpm install

# Start both frontend and backend in development
pnpm run dev

# Frontend only (from apps/web)
pnpm run dev  # Runs on http://localhost:4000

# Backend only (from apps/server)
pnpm run dev  # Runs on http://localhost:4001

# Clean up rogue processes on ports 4000/4001 (if servers won't start)
./scripts/cleanup-ports.sh
```

### Database Management

```bash
# Development database setup (PostgreSQL container on port 55432)
./scripts/dev-db.sh setup  # Start DB + run migrations + seed data

# Clear all conversations and start fresh (development only)
./scripts/clear-conversations.sh

# Test database (separate container)
./scripts/test-db.sh start
RUN_DB_TESTS=1 pnpm run test conversationService.test.ts
./scripts/test-db.sh stop
```

### Testing

```bash
# All tests via turbo
pnpm run test

# Server unit tests (no DB)
pnpm run test sessionManager.simple.test.ts toolExecutorService.simple.test.ts

# Server database tests (requires test DB running)
RUN_DB_TESTS=1 pnpm run test conversationService.test.ts

# IMPORTANT: Use "pnpm run test" (Vitest) for proper mocking support
```

### Build & Quality

```bash
pnpm run build      # Build all apps
pnpm run lint       # ESLint + Biome
pnpm run format     # Prettier formatting
```

## Architecture & Key Services

### Database Schema (Drizzle ORM)

Complex streaming conversation system with these key tables:

- `users`, `conversations` - Basic user/chat structure
- `messages`, `prompts` - User messages and AI prompt states
- `events`, `blocks` - Streaming event log and content blocks
- `tool_calls` - Tool execution with state tracking, retries, timeouts
- `attachments` - File attachments linked to blocks

**Important**: The schema includes sophisticated tool execution tracking with PIDs, heartbeats, and retry logic.

### Core Services

- **ConversationService**: Manages conversation lifecycle, message history
- **StreamingStateMachine**: Processes real-time AI streaming events
- **ToolExecutorService**: Handles tool execution with session management
- **SessionManager**: Manages isolated tool execution sessions

### API Architecture

- REST endpoints for conversation CRUD (`/api/conversations/*`)
- WebSocket streaming for real-time AI responses
- Anthropic SDK integration with tool support (bash tools enabled)
- Broadcast system for multi-client WebSocket synchronization

## Development Guidelines

### Package Management

- **Always use pnpm** (not npm/bun) - configured as packageManager in root package.json
- Install from root for monorepo dependencies

### Code Style

- 2 spaces, 80 char lines, single quotes, no semicolons
- Use `@/` path aliases for imports
- TypeScript strict mode enabled with additional strictness flags
- React function components with explicit prop interfaces

### Database Migrations

- Use Drizzle Kit: `pnpm run db:generate` → `pnpm run db:migrate`
- Development DB runs in Docker container (port 55432)
- Always run migrations via `./scripts/dev-db.sh setup` for development

### Testing Strategy

- Unit tests: No external dependencies
- Integration tests: Require test database
- **Critical**: Always use `pnpm run test` (Vitest) for proper mocking support

### Environment Setup

- Requires `ANTHROPIC_API_KEY` environment variable
- Both servers bind to `0.0.0.0` for development flexibility
- CORS configured for multiple localhost origins

## Important Notes

- The application has a sophisticated streaming architecture that requires careful handling of WebSocket connections and database state
- Tool execution is session-based with proper isolation and cleanup
- The conversation system maintains detailed event logs for streaming reconstruction
- Always test database-dependent changes with the proper test database setup
