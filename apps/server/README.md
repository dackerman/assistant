# server

To install dependencies:

```bash
pnpm install
```

To run in development:

```bash
# First, start the development database and seed it with default data
./scripts/dev-db.sh setup

# Then run the server
pnpm run dev
```

The setup command will:

- Start a PostgreSQL container on port 55432
- Run database migrations
- Seed the database with a default user (required by the app)

## Testing

### Unit Tests

Run unit tests (no database required):

```bash
pnpm run test sessionManager.simple.test.ts toolExecutorService.simple.test.ts
```

### Database Tests

For tests that require a database, first start the test database:

```bash
./scripts/test-db.sh start
```

Then run database tests (migrations will be applied automatically):

```bash
RUN_DB_TESTS=1 pnpm run test conversationService.test.ts
```

**Note:** Use `pnpm run test` (Vitest) for proper functionality including mocking.

Stop the test database when done:

```bash
./scripts/test-db.sh stop
```

### Database Management

#### Development Database

The `scripts/dev-db.sh` script manages the development database:

- `setup` - Start database and run migrations (recommended)
- `start` - Start the development database container
- `stop` - Stop the development database container
- `migrate` - Run database migrations
- `status` - Show container status

#### Test Database

The `scripts/test-db.sh` script manages the test database:

- `start` - Start the test database container
- `stop` - Stop the test database container
- `remove` - Remove the test database container completely
- `status` - Show container status
- `restart` - Restart the test database container

This project uses Node.js with TypeScript and Hono framework for the backend runtime.
