# Core

Full-stack TypeScript application with Vite + React frontend and Node.js + Hono backend.

## Prerequisites

- Node.js (v18 or higher)
- pnpm (v9.0.0)
- Docker (for PostgreSQL database)

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Set up the development database:

```bash
cd apps/server && ./scripts/dev-db.sh setup
```

3. Start both frontend and backend:

```bash
pnpm run dev
```

## Services

- **Frontend**: http://localhost:4000 (or http://0.0.0.0:4000)
- **Backend**: http://localhost:4001 (or http://0.0.0.0:4001)
- **Database**: PostgreSQL on port 55432 (dev) / 55433 (test)

## Available Commands

- `pnpm run dev` - Start all services in development mode
- `pnpm run dev:logs` - Start with file logging enabled
- `pnpm run build` - Build all applications
- `pnpm run test` - Run all tests
- `pnpm run lint` - Lint all code with Biome
- `pnpm run format` - Format all code with Biome
- `pnpm run format:imports` - Format and organize imports
- `pnpm run clean` - Clean build artifacts

## Tech Stack

- **Frontend**: Vite + React + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Node.js + Hono + TypeScript + Drizzle ORM
- **Database**: PostgreSQL with Drizzle migrations
- **Testing**: Vitest
- **Build**: Turbo (monorepo)
- **Linting/Formatting**: Biome

## Project Structure

```
core/
├── apps/
│   ├── web/          # React frontend application
│   └── server/       # Node.js backend API
├── docs/             # Documentation
├── scripts/          # Utility scripts
└── turbo.json        # Turbo configuration
```

## Development

Both servers are configured to accept connections from any host (0.0.0.0) for development convenience.

For detailed setup instructions for each app, see:
- [Frontend README](./apps/web/README.md)
- [Backend README](./apps/server/README.md)
