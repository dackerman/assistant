# server

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Testing

### Unit Tests

Run unit tests (no database required):

```bash
bun run test sessionManager.simple.test.ts toolExecutorService.simple.test.ts
```

### Database Tests

For tests that require a database, first start the test database:

```bash
./scripts/test-db.sh start
```

Then run database tests (migrations will be applied automatically):

```bash
RUN_DB_TESTS=1 bun run test conversationService.test.ts
```

Stop the test database when done:

```bash
./scripts/test-db.sh stop
```

**Note:** Use `bun run test` (not `bun test`) to enable proper Vitest functionality including mocking.

Then run database tests (note: use `bun run test` not `bun test`):

```bash
RUN_DB_TESTS=1 bun run test conversationService.test.ts
```

**Important**: Use `bun run test` (which runs vitest) instead of `bun test` for proper mocking support.

Stop the test database when done:

```bash
./scripts/test-db.sh stop
```

### Test Database Management

The `scripts/test-db.sh` script provides several commands:

- `start` - Start the test database container
- `stop` - Stop the test database container
- `remove` - Remove the test database container completely
- `status` - Show container status
- `restart` - Restart the test database container

This project was created using `bun init` in bun v1.2.13. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
