import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import 'dotenv/config'

export type DB =
  | PostgresJsDatabase<typeof schema>
  | NodePgDatabase<typeof schema>

// Create a PostgreSQL connection
const connectionString =
  process.env.NODE_ENV === 'test'
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL

let queryClient: ReturnType<typeof postgres> | null = null

if (connectionString) {
  // For query purposes
  queryClient = postgres(connectionString)
}

// Create drizzle instance (guarded for test environments without DB)
export const db: DB = queryClient
  ? drizzle(queryClient, { schema })
  : (new Proxy(
      {},
      {
        get() {
          throw new Error(
            'Database not configured. Set DATABASE_URL or TEST_DATABASE_URL.'
          )
        },
      }
    ) as unknown as DB)

// Export schema for easy access
export * from './schema'

// Utility function to clean up connections
export async function closeDatabase() {
  if (queryClient) await queryClient.end()
}
