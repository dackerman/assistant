# Core

Full-stack TypeScript application with Vite + React frontend and Bun + Hono backend.

## Quick Start

Install dependencies:
```bash
bun install
```

Start both frontend and backend:
```bash
bun run dev
```

## Services

- **Frontend**: http://localhost:4000 (or http://0.0.0.0:4000)
- **Backend**: http://localhost:4001 (or http://0.0.0.0:4001)

## Available Commands

- `bun run dev` - Start all services in development mode
- `bun run build` - Build all applications
- `bun run test` - Run all tests
- `bun run lint` - Lint all code
- `bun run format` - Format all code with Prettier

## Tech Stack

- **Frontend**: Vite + React + TypeScript + Tailwind CSS + ShadCN/ui
- **Backend**: Bun + Hono + TypeScript
- **Testing**: Vitest + Playwright
- **Build**: Turbo (monorepo)
- **Formatting**: Prettier + Biome

## Development

Both servers are configured to accept connections from any host (0.0.0.0) for development convenience.
