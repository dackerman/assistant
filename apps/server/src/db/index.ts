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
  const client = postgres(connectionString, {
    max: 1,
    ...poolOptions,
    ...(enableLogging
      ? {
          debug: (connectionId: number, query: unknown, parameters: unknown) => {
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

  if (enableLogging) {
    instrumentQueryClient(client, dbLogger)
  }

  return client
}

export { createPostgresClient, type CreatePostgresClientOptions }

function instrumentQueryClient(
  client: ReturnType<typeof postgres>,
  dbLogger: ReturnType<typeof logger.child>
) {
  const originalUnsafe = client.unsafe.bind(client)

  client.unsafe = ((query: unknown, params?: unknown) => {
    const sqlText = normalizeSql(query)
    const operation = getSqlOperation(sqlText)
    const parameters = Array.isArray(params) ? params : params ? [params] : []

    const pending = originalUnsafe(query as any, params as any)

    let resultLogged = false

    const logResult = (result: unknown) => {
      if (resultLogged) return result
      resultLogged = true

      if (operation === 'read') {
        dbLogger.debug('DB read result', {
          sql: sqlText,
          rowCount: Array.isArray(result) ? result.length : undefined,
          rows: result,
        })
      } else if (operation === 'write') {
        dbLogger.debug('DB write result', {
          sql: sqlText,
          parameters,
          result,
        })
      } else {
        dbLogger.debug('DB operation result', {
          sql: sqlText,
          result,
        })
      }

      return result
    }

    const logError = (error: unknown) => {
      dbLogger.error('DB query failed', {
        sql: sqlText,
        parameters,
        error,
      })
      return error
    }

    if (typeof pending.then === 'function') {
      const originalThen = pending.then.bind(pending)
      pending.then = ((onFulfilled?: unknown, onRejected?: unknown) =>
        originalThen(
          (value: unknown) => {
            const result = logResult(value)
            return typeof onFulfilled === 'function'
              ? onFulfilled(result)
              : result
          },
          (error: unknown) => {
            logError(error)
            if (typeof onRejected === 'function') {
              return onRejected(error)
            }
            throw error
          }
        )) as typeof pending.then
    }

    if (typeof pending.values === 'function') {
      const originalValues = pending.values.bind(pending)
      pending.values = (() =>
        originalValues().then(
          (value: unknown) => logResult(value),
          (error: unknown) => {
            logError(error)
            throw error
          }
        )) as typeof pending.values
    }

    return pending
  }) as typeof client.unsafe
}

function normalizeSql(query: unknown): string {
  if (typeof query === 'string') {
    return query.trim()
  }
  if (query && typeof query === 'object' && 'text' in query && query.text) {
    return (query as { text: string }).text.trim()
  }
  return String(query).trim()
}

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
