# Technology Stack

## Core Technologies

### Backend Runtime & Framework

- **Runtime**: Node.js
  - Mature and stable runtime environment
  - Excellent ecosystem and community support
  - Reliable performance for server applications
- **Framework**: Hono
  - Lightweight and performant
  - Edge-compatible
  - Excellent middleware system for MCP integrations
  - Built-in WebSocket support

### Frontend Framework

- **Build Tool**: Vite
  - Lightning fast HMR (Hot Module Replacement)
  - Native ES modules
  - Optimized production builds
  - Excellent TypeScript support
- **Framework**: React with React Router
  - Client-side routing with React Router v6
  - Full control over architecture
  - Simpler mental model than meta-frameworks
- **UI Components**:
  - ShadCN/ui - Copy-paste component library
  - Radix UI - Accessible headless components
  - Tailwind CSS - Utility-first styling

### Database & ORM

- **Database**: PostgreSQL
  - Mature, reliable, feature-rich
  - Excellent for complex queries and relationships
  - MCP server already available

- **ORM/Query Builder**: Drizzle ORM
  - Lightweight with excellent TypeScript support
  - SQL-like syntax familiar to developers
  - Better performance than traditional ORMs
  - Built-in migration tool (Drizzle Kit)

### AI/LLM Integration

- **Primary**: Vercel AI SDK
  - Unified interface for multiple providers
  - Built-in streaming support
  - Tool calling capabilities
  - Provider agnostic (OpenAI, Anthropic, etc.)

- **MCP Integration**: Model Context Protocol
  - Direct integration with MCP servers
  - Extensible tool system

### Real-time Communication

- **WebSocket**: Hono WebSocket
  - Integrated with main framework
  - Lightweight implementation
  - Custom reconnection logic
- **Protocol**: JSON-RPC 2.0
  - Structured communication
  - Request/response pattern
  - Error handling built-in

### Testing

- **Unit/Integration**: Vitest
  - Fast execution
  - Native TypeScript support
  - Works seamlessly with Vite
  - Same config as Vite
- **E2E Testing**: Playwright
  - Cross-browser testing
  - Reliable automation
  - Visual regression testing

### Build Tools & Development

- **Monorepo**: Turbo
  - Incremental builds
  - Intelligent caching
  - Task orchestration

- **Code Quality**: Biome
  - Fast linting and formatting
  - Replaces ESLint + Prettier
  - Single configuration

- **TypeScript Execution**: tsx
  - Run TypeScript files directly
  - Useful for scripts and development

## Additional Libraries

### Authentication & Security

- **Auth**: Lucia Auth
  - Framework agnostic
  - Session management
  - Multiple provider support
- **Validation**: Zod
  - Runtime type checking
  - Schema validation

### State Management

- **Client State**: Zustand
  - Simple and lightweight
  - TypeScript friendly
- **Server State**: TanStack Query
  - Caching and synchronization
  - Optimistic updates

### File Handling

- **Uploads**: local file storage
- **Processing**: Sharp for images, FFmpeg for video

### Utilities

- **Date/Time**: date-fns
- **HTTP Client**: native fetch
- **Environment**: dotenv for configuration

## Development Workflow

### Version Control

- Git with conventional commits
- GitHub for repository hosting
- GitHub Actions for CI/CD

### Development Environment

- VSCode with TypeScript extensions
- Docker for containerization (optional)
- Development/staging/production environments

### Deployment

- **Primary**: Self-hosted on VPS/dedicated server
- **CDN**: Cloudflare for static assets and edge functions
- **Process Manager**: PM2 or systemd for production

## Android Agent Stack

### Native Development

- **Language**: Kotlin
- **Framework**: Android SDK
- **Async**: Coroutines
- **Networking**: OkHttp + WebSocket
- **Serialization**: Kotlinx.serialization

## Architecture Principles

1. **TypeScript First**: Full type safety across the stack
2. **Performance Focused**: Choose lightweight, fast libraries
3. **Developer Experience**: Tools that improve productivity
4. **Modularity**: Loosely coupled components
5. **Security**: Input validation, secure defaults
6. **Observability**: Structured logging, monitoring
