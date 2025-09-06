# Core

Full-stack TypeScript application with Vite + React frontend and Node.js + Hono backend.

## Quick Start

Install dependencies:

```bash
pnpm install
```

Start both frontend and backend:

```bash
pnpm run dev
```

## Services

- **Frontend**: http://localhost:4000 (or http://0.0.0.0:4000)
- **Backend**: http://localhost:4001 (or http://0.0.0.0:4001)

## Available Commands

- `pnpm run dev` - Start all services in development mode
- `pnpm run build` - Build all applications
- `pnpm run test` - Run all tests
- `pnpm run lint` - Lint all code
- `pnpm run format` - Format all code with Prettier

## Tech Stack

- **Frontend**: Vite + React + TypeScript + Tailwind CSS + ShadCN/ui
- **Backend**: Node.js + Hono + TypeScript
- **Testing**: Vitest + Playwright
- **Build**: Turbo (monorepo)
- **Formatting**: Prettier + Biome

## Development

Both servers are configured to accept connections from any host (0.0.0.0) for development convenience.
