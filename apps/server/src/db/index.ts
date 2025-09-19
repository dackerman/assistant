import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import 'dotenv/config'
import { logger } from '../utils/logger'

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
  queryClient = createPostgresClient(connectionString)
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

type CreatePostgresClientOptions = {
  enableLogging?: boolean
  poolOptions?: Parameters<typeof postgres>[1]
}

function createPostgresClient(
  connectionString: string,
  options: CreatePostgresClientOptions = {}
) {
  const { enableLogging = true, poolOptions } = options
  const dbLogger = logger.child({ service: 'Database' })
  return postgres(connectionString, {
    max: 1,
    ...poolOptions,
    ...(enableLogging
      ? {
          debug: (
            connectionId: number,
            query: unknown,
            parameters: unknown
          ) => {
            const sql = typeof query === 'string' ? query : String(query)
            const operation = getSqlOperation(sql)
            const payload = {
              connectionId,
              sql,
              parameters,
            }

            if (operation === 'read') {
              dbLogger.debug('DB read query', payload)
            } else if (operation === 'write') {
              dbLogger.debug('DB write query', payload)
            } else {
              dbLogger.debug('DB query', payload)
            }
          },
        }
      : {}),
  })
}

export { createPostgresClient, type CreatePostgresClientOptions }

function getSqlOperation(sql: string): 'read' | 'write' | 'other' {
  const command = sql.split(/\s+/)[0]?.toUpperCase()
  if (!command) return 'other'
  if (command === 'SELECT' || command === 'WITH') return 'read'
  if (
    command === 'INSERT' ||
    command === 'UPDATE' ||
    command === 'DELETE' ||
    command === 'UPSERT'
  ) {
    return 'write'
  }
  return 'other'
}
