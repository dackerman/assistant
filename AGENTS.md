# Repository Guidelines

## Project Structure & Module Organization
- `src/`: TypeScript source for both frontend and backend
  - `src/main.tsx`, `src/App.tsx`, `src/components/*`: React + Vite frontend (port 7653)
  - `src/index.ts`: Express backend and SSE endpoints (port 7654)
- `tests/e2e/*.spec.ts`: Playwright end‑to‑end tests and setup files
- `docs/`: Architecture and ideas
- Config: `vite.config.ts`, `tsconfig.json`, `.prettierrc`, `playwright.config.ts`

## Build, Test, and Development Commands
- `pnpm run dev`: Run backend and frontend concurrently (hot reload)
- `pnpm run dev:backend` / `pnpm run dev:frontend`: Start each side separately
- `pnpm run build`: Type-check (`tsc`) and build Vite assets
- `pnpm run format` / `format:check`: Auto-format or verify formatting
- `pnpm run test:e2e`: Run Playwright tests locally
- Docker E2E helpers: `test:e2e:docker`, `test:e2e:headed`, `test:e2e:vnc` (browser at `http://localhost:6080`)
- Reports: `pnpm run test:report` (after a test run)

## Coding Style & Naming Conventions
- Language: TypeScript (strict where possible), React function components
- Formatting: Prettier enforced via `.prettierrc` (2 spaces, 80 cols, single quotes, trailing commas)
- Naming: `PascalCase` for components, `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for env vars
- Files: React components in `src/components/Name.tsx`; hooks in `src/hooks/useThing.ts`

## Testing Guidelines
- Framework: Playwright for E2E; specs in `tests/e2e/*.spec.ts`
- Conventions: Test filenames end with `.spec.ts`; prefer descriptive `test()` titles
- Running: `pnpm run test:e2e` locally; `pnpm run test:e2e:docker` in isolated env
- Debugging: `pnpm run test:e2e:ui` or `pnpm exec playwright test --debug tests/e2e/debug.spec.ts`

## Commit & Pull Request Guidelines
- Commits: Imperative, concise subjects (e.g., "Add Playwright E2E tests", "Fix VNC setup"). Group related changes.
- PRs: Provide summary, rationale, and screenshots/GIFs for UI changes. Link issues. Note test coverage and run E2E locally before requesting review.
- Branches: Prefer short, purpose-driven names, e.g., `feat/session-picker`, `fix/docker-vnc`.

## Security & Configuration Tips
- OpenCode CLI should be running on port 4096 during development/testing.
- Do not commit secrets. Pass API keys via environment variables.
- Useful envs: `RECORD_VIDEO=true pnpm run test:e2e:docker` to capture videos.

