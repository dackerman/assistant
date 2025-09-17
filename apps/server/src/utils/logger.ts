import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

interface LogContext {
  conversationId?: number
  promptId?: number
  userId?: number
  messageId?: number
  blockId?: number
  eventIndex?: number
  model?: string
  wsClientId?: string
  [key: string]: unknown
}

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private context: LogContext = {}
  private level: LogLevel = LogLevel.INFO
  private logDir: string
  private enableFileLogging: boolean
  private logFileTimestamp: string

  constructor(initialContext: LogContext = {}) {
    this.context = initialContext

    // Generate unique timestamp for this server run
    const isoString = new Date().toISOString()
    const dateTimePart = isoString.split('.')[0] || isoString // Remove milliseconds first: YYYY-MM-DDTHH:MM:SS
    this.logFileTimestamp = dateTimePart
      .replace(/[:.]/g, '-') // Replace : and . with - for safe filename
      .replace('T', '_') // Replace T with _ for readability: YYYY-MM-DD_HH-MM-SS

    // Set log level from environment
    const envLevel = process.env.LOG_LEVEL?.toUpperCase()
    if (envLevel && envLevel in LogLevel) {
      this.level = LogLevel[envLevel as keyof typeof LogLevel]
    }

    // Configure file logging
    this.enableFileLogging = process.env.LOG_TO_FILE === 'true'
    this.logDir = process.env.LOG_DIR || join(process.cwd(), 'logs')

    // Create logs directory if file logging is enabled
    if (this.enableFileLogging && !existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }
  }

  // Create a new logger with additional context
  child(additionalContext: LogContext): Logger {
    const childLogger = new Logger({ ...this.context, ...additionalContext })
    childLogger.level = this.level
    childLogger.enableFileLogging = this.enableFileLogging
    childLogger.logDir = this.logDir
    childLogger.logFileTimestamp = this.logFileTimestamp // Preserve the original timestamp
    return childLogger
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ) {
    if (level < this.level) return

    const timestamp = new Date().toISOString()
    const levelStr = LogLevel[level]

    const logEntry = {
      timestamp,
      level: levelStr,
      message,
      context: this.context,
      ...(data && { data }),
    }

    // Write to file if enabled
    if (this.enableFileLogging) {
      const logFile = join(this.logDir, `app-${this.logFileTimestamp}.log`)
      const logLine = `${JSON.stringify(logEntry)}\n`

      try {
        appendFileSync(logFile, logLine)
      } catch (error) {
        // If file logging fails, at least log to console
        console.error('Failed to write to log file:', error)
      }
    }

    // Console output
    if (process.env.NODE_ENV === 'development') {
      const contextStr =
        Object.keys(this.context).length > 0
          ? ` [${Object.entries(this.context)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')}]`
          : ''

      console.log(
        `${timestamp} ${levelStr.padEnd(5)} ${message}${contextStr}`,
        data ? data : ''
      )
    } else {
      // JSON for production
      console.log(JSON.stringify(logEntry))
    }
  }

  debug(message: string, data?: Record<string, unknown>) {
    this.log(LogLevel.DEBUG, message, data)
  }

  info(message: string, data?: Record<string, unknown>) {
    this.log(LogLevel.INFO, message, data)
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.log(LogLevel.WARN, message, data)
  }

  error(message: string, error?: Error | unknown) {
    const data =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error && typeof error === 'object'
          ? (error as Record<string, unknown>)
          : { error }

    this.log(LogLevel.ERROR, message, data)
  }

  // Specialized logging methods for common operations

  wsEvent(event: string, data?: Record<string, unknown>) {
    this.debug(`WebSocket: ${event}`, data)
  }

  stateTransition(from: string, to: string, data?: Record<string, unknown>) {
    this.info(`State transition: ${from} → ${to}`, data)
  }

  apiCall(method: string, endpoint: string, data?: Record<string, unknown>) {
    this.debug(`API call: ${method} ${endpoint}`, data)
  }

  anthropicEvent(eventType: string, data?: Record<string, unknown>) {
    this.debug(`Anthropic: ${eventType}`, data)
  }

  dbOperation(
    operation: string,
    table: string,
    data?: Record<string, unknown>
  ) {
    this.debug(`DB: ${operation} ${table}`, data)
  }
}

// Create global logger instance
const logger = new Logger()

export { Logger, logger, type LogContext }
