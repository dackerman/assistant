# Server Backend

Node.js backend API built with Hono framework and PostgreSQL database.

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Hono (lightweight web framework)
- **Database**: PostgreSQL with Drizzle ORM
- **Testing**: Vitest
- **Process Management**: node-pty for terminal sessions

## Quick Start

Install dependencies:

```bash
pnpm install
```

Start development environment:

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

## Available Scripts

- `pnpm run dev` - Start development server with auto-reload
- `pnpm run build` - Build TypeScript files
- `pnpm run test` - Run all tests
- `pnpm run lint` - Check code with Biome
- `pnpm run typecheck` - Run TypeScript type checking

## Project Structure

```
src/
├── db/              # Database configuration and migrations
│   ├── migrations/  # Drizzle migration files
│   ├── index.ts     # Database connection
│   └── schema.ts    # Database schema definitions
├── services/        # Business logic and services
│   ├── tools/       # Tool implementations
│   └── *.ts         # Core services (conversation, prompt, etc.)
├── test/            # Test utilities and fixtures
└── utils/           # Utility functions
```

## Database Management

This project uses Drizzle ORM for database management. Migrations are stored in `src/db/migrations/`.

### Creating Migrations

To generate a new migration after schema changes:

```bash
pnpm drizzle-kit generate
```

To apply migrations:

```bash
pnpm drizzle-kit migrate
```

## Configuration

Environment variables are configured in `.env` (copy from `.env.example`):

```bash
cp .env.example .env
```

Key configurations:
- `DATABASE_URL` - PostgreSQL connection string
- `PORT` - Server port (default: 4001)
- `NODE_ENV` - Environment (development/production)
