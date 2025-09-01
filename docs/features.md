# Core Features

## Agent Capabilities

- **Full System Control**: Agent can execute any bash command on the host machine
- **Web-Based Interface**: Operates through a webapp interface similar to LibreChat
- **Connections / Integrations**: Connect MCP servers and programs to manage our family
  - PostgreSQL MCP for shared state / memory / persistence
  - Subagents MCP for delegating tasks
  - MCP client renders frontend components
  - ntfy.sh for notifying android clients
  - Asana for task management
  - Google Calendar and Gmail
  - GitHub for code repositories
  - AWS and Cloudflare for infrastructure
  - OpenAI, Claude, and Gemini for AI services (which can be invoked via script)
  - various other programs installed on the machine can all be invoked (e.g. ffmpeg)

## Self-Modifying Architecture

- **Self-Editing Application**: Agent can modify its own codebase and interface
- **Live Development**: Runs in dev mode with auto-reload capabilities
- **Safe Development Environment**:
  - Production instance runs stable version
  - Development/staging environments at separate ports
  - Self-deployment system that applies updates only when tests pass
- **Isolation Protection**: Prevents agent from breaking itself during modifications

## Frontend Framework

- **Component System**: Built with modern UI libraries (ShadCN)
- **Database Integration**: PostgreSQL ORM/query support
- **React-Based**: TypeScript React application
- **Extension-Ready**: Simple forms, interactive elements, and reporting frameworks

## Dynamic UI Generation

- **Inline UI Rendering**: LLM can return and render UI components directly
- **Context-Aware Interfaces**: Adaptive UIs based on user needs
- **Interactive Elements**:
  - Food picker for calorie tracking
  - Counter interfaces for exercise logging
  - Custom form generators

## Support for invoking Android

## Hosting and Deployment

- **Dynamic Subdomain Management**: Cloudflare-based subdomain creation
- **Multi-Project Support**:
  - Separate GitHub repositories for different projects
  - Centralized agent-specific UIs
  - Shared PostgreSQL database across projects
- **Local Development Server**: Single server hosting multiple disparate applications
