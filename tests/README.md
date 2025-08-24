# E2E Testing with Playwright

This project uses Playwright for end-to-end testing with real OpenCode API integration.

## Quick Start

### Docker Method (Recommended for NixOS)

Uses real OpenCode instance in Docker container:

```bash
# Run all tests with real OpenCode in Docker
./test-docker.sh

# Or use docker-compose directly
docker-compose -f docker-compose.test.yml up --abort-on-container-exit
```

### Local Method (Requires OpenCode CLI)

Spawns OpenCode locally in test directory:

```bash
# Run tests with local OpenCode instance
./test-local.sh

# Or run Playwright directly (auto-starts OpenCode)
pnpm test:e2e
```

## Local Development

```bash
# Install Playwright browsers (not needed on NixOS with Docker)
pnpm test:install

# Run tests
pnpm test:e2e

# Run tests with UI mode
pnpm test:e2e:ui

# Run specific test file
pnpm test:e2e tests/e2e/session.spec.ts

# Run tests in headed mode (see browser)
pnpm test:e2e --headed
```

## Writing Tests

Tests are located in `tests/e2e/`. Each test file should:

1. Import from `@playwright/test`
2. Use descriptive test names
3. Follow the Page Object Model pattern for complex interactions
4. Include both desktop and mobile tests

Example test:

```typescript
import { test, expect } from '@playwright/test';

test('should create a new session', async ({ page }) => {
  await page.goto('/');
  await page.click('.new-session-btn');
  await expect(page.locator('h1')).toContainText('Personal Assistant');
});
```

## Docker Setup Details

The Docker setup uses the official Playwright image (`mcr.microsoft.com/playwright`) which includes:

- All browser binaries (Chromium, Firefox, WebKit)
- System dependencies
- Node.js runtime

This is especially useful on NixOS where setting up browser binaries can be challenging.

## CI/CD

GitHub Actions automatically runs tests on:

- Push to main/master
- Pull requests

The CI pipeline:

1. Sets up Node.js and pnpm
2. Installs dependencies
3. Starts a mock OpenCode server
4. Runs all Playwright tests
5. Uploads test reports as artifacts

## Debugging Failed Tests

1. **View HTML Report**: After tests run, open `playwright-report/index.html`
2. **Screenshots**: Failed tests automatically capture screenshots in `test-results/`
3. **Traces**: View step-by-step execution traces for failed tests
4. **UI Mode**: Use `pnpm test:e2e:ui` for interactive debugging

## Test Architecture

### Real OpenCode Integration

Tests use a real OpenCode instance to ensure authentic API behavior:

- **Test Directory**: `.test-opencode/` (automatically created and cleaned)
- **Port**: 4096 (default OpenCode port)
- **Configuration**: Minimal config with memory storage
- **Isolation**: Each test run starts with a clean OpenCode instance

### Why Real API?

- **Authentic Behavior**: Tests interact with actual OpenCode API
- **Real SSE Events**: Genuine event streaming and message handling
- **Tool Execution**: Real tool calls and responses
- **State Management**: Actual session creation and management

### Mock Server (Deprecated)

The mock server in `tests/mocks/opencode-mock.ts` is kept for reference but not used by default.

## Test Coverage

Current test coverage includes:

- ✅ Session management (create, switch, list)
- ✅ Message sending and receiving
- ✅ Debug panel toggle
- ✅ Mobile responsiveness
- ✅ Touch interactions
- ⬜ Tool execution display
- ⬜ Error handling
- ⬜ SSE connection recovery
