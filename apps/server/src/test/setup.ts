import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createPostgresClient } from '../db'
import * as schema from '../db/schema'

let container: StartedPostgreSqlContainer | null = null
let sqlClient: ReturnType<typeof createPostgresClient> | null = null
export let testDb: PostgresJsDatabase<typeof schema>

export async function setupTestDatabase() {
  if (!container) {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('test_db')
      .withUsername('test_user')
      .withPassword('test_pass')
      .start()
  }

  process.env.TEST_DATABASE_URL = container.getConnectionUri()

  const connectionString = container.getConnectionUri()
  sqlClient = createPostgresClient(connectionString, { enableLogging: false })

  // Use proper Drizzle migrations instead of manual schema creation
  const migrationDb = drizzle(sqlClient, { schema })
  await migrate(migrationDb, { migrationsFolder: './src/db/migrations' })

  testDb = drizzle(sqlClient, { schema })
}

export async function teardownTestDatabase() {
  if (sqlClient) {
    await sqlClient.end()
    sqlClient = null
  }
  if (container) {
    await container.stop()
    container = null
  }
}