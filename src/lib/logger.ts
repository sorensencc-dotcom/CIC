/**
 * Structured logger for CIC observability
 * Stub implementation for Phase 2
 */

export interface LogContext {
  [key: string]: unknown
}

export interface Logger {
  info(event: string, context?: LogContext): void
  warn(event: string, context?: LogContext): void
  error(event: string, context?: LogContext): void
  debug(event: string, context?: LogContext): void
}

class CICLogger implements Logger {
  info(event: string, context?: LogContext): void {
    console.log(JSON.stringify({ level: "INFO", event, ...context }))
  }

  warn(event: string, context?: LogContext): void {
    console.warn(JSON.stringify({ level: "WARN", event, ...context }))
  }

  error(event: string, context?: LogContext): void {
    console.error(JSON.stringify({ level: "ERROR", event, ...context }))
  }

  debug(event: string, context?: LogContext): void {
    if (process.env.DEBUG) {
      console.debug(JSON.stringify({ level: "DEBUG", event, ...context }))
    }
  }
}

export const logger = new CICLogger()
