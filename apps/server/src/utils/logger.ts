interface LogContext {
  conversationId?: number;
  promptId?: number;
  userId?: number;
  messageId?: number;
  blockId?: number;
  eventIndex?: number;
  model?: string;
  wsClientId?: string;
  [key: string]: any;
}

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private context: LogContext = {};
  private level: LogLevel = LogLevel.INFO;

  constructor(initialContext: LogContext = {}) {
    this.context = initialContext;

    // Set log level from environment
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLevel && envLevel in LogLevel) {
      this.level = LogLevel[envLevel as keyof typeof LogLevel];
    }
  }

  // Create a new logger with additional context
  child(additionalContext: LogContext): Logger {
    const childLogger = new Logger({ ...this.context, ...additionalContext });
    childLogger.level = this.level;
    return childLogger;
  }

  private log(level: LogLevel, message: string, data?: any) {
    if (level < this.level) return;

    const timestamp = new Date().toISOString();
    const levelStr = LogLevel[level];

    const logEntry = {
      timestamp,
      level: levelStr,
      message,
      context: this.context,
      ...(data && { data }),
    };

    // Pretty print for development
    if (process.env.NODE_ENV === "development") {
      const contextStr =
        Object.keys(this.context).length > 0
          ? ` [${Object.entries(this.context)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}]`
          : "";

      console.log(
        `${timestamp} ${levelStr.padEnd(5)} ${message}${contextStr}`,
        data ? data : "",
      );
    } else {
      // JSON for production
      console.log(JSON.stringify(logEntry));
    }
  }

  debug(message: string, data?: any) {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: any) {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: any) {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, error?: Error | any) {
    const data =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error;

    this.log(LogLevel.ERROR, message, data);
  }

  // Specialized logging methods for common operations

  wsEvent(event: string, data?: any) {
    this.debug(`WebSocket: ${event}`, data);
  }

  stateTransition(from: string, to: string, data?: any) {
    this.info(`State transition: ${from} → ${to}`, data);
  }

  apiCall(method: string, endpoint: string, data?: any) {
    this.debug(`API call: ${method} ${endpoint}`, data);
  }

  anthropicEvent(eventType: string, data?: any) {
    this.debug(`Anthropic: ${eventType}`, data);
  }

  dbOperation(operation: string, table: string, data?: any) {
    this.debug(`DB: ${operation} ${table}`, data);
  }
}

// Create global logger instance
const logger = new Logger();

export { Logger, logger, type LogContext };
