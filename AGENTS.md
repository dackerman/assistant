# Agent Guidelines for Core Codebase

## Build/Test Commands

- **Build all**: `pnpm run build` (turbo monorepo)
- **Test all**: `pnpm run test` (turbo monorepo)
- **Test single file**: `cd apps/web && pnpm test src/path/to/file.test.tsx`
- **Lint**: `pnpm run lint` (ESLint + Biome)
- **Format**: `pnpm run format` (Prettier)
- **Dev servers**: `pnpm run dev` (both apps via turbo)

## Code Style

- **Package manager**: Use `pnpm` (not npm/bun)
- **Formatting**: 2 spaces, 80 char line width, single quotes, no semicolons
- **Imports**: Use `@/` aliases, organize imports automatically (Biome)
- **Types**: Explicit interfaces, `type` for unions, React types (`React.KeyboardEvent`)
- **Naming**: camelCase for variables/functions, PascalCase for components/types
- **Error handling**: Use proper TypeScript error types, avoid `any`
- **React**: Function components with typed props interfaces
- **Backend**: Hono framework with TypeScript, structured route handlers

## Project Structure

- Turbo monorepo: `apps/web` (React+Vite), `apps/server` (Hono+Node.js)
- UI components in `@/components/ui/` (shadcn/ui based)
- Types in dedicated `types/` directories
