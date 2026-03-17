/**
 * Structured logger utility
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
  error?: Error;
}

class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = "info";

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  private formatMessage(
    level: LogLevel,
    component: string,
    message: string,
    data?: Record<string, unknown>,
    error?: Error
  ): string {
    const timestamp = new Date().toISOString();
    const levelUpper = level.toUpperCase().padEnd(5);
    let log = `[${timestamp}] ${levelUpper} [${component}] ${message}`;
    
    if (data && Object.keys(data).length > 0) {
      log += ` | data: ${JSON.stringify(data)}`;
    }
    
    if (error) {
      log += ` | error: ${error.message}`;
      if (error.stack) {
        log += `\n${error.stack}`;
      }
    }
    
    return log;
  }

  debug(component: string, message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", component, message, data));
    }
  }

  info(component: string, message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", component, message, data));
    }
  }

  warn(component: string, message: string, data?: Record<string, unknown>, error?: Error): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", component, message, data, error));
    }
  }

  error(component: string, message: string, error?: Error, data?: Record<string, unknown>): void {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", component, message, data, error));
    }
  }

  /**
   * Log API request
   */
  logRequest(
    component: string,
    method: string,
    path: string,
    data?: { userId?: string; sessionId?: string; [key: string]: unknown }
  ): void {
    this.info(component, `Request: ${method} ${path}`, data);
  }

  /**
   * Log API response
   */
  logResponse(
    component: string,
    method: string,
    path: string,
    statusCode: number,
    durationMs: number,
    data?: { error?: boolean; [key: string]: unknown }
  ): void {
    const level = statusCode >= 400 ? "warn" : "info";
    const message = `Response: ${method} ${path} - Status: ${statusCode} - Duration: ${durationMs}ms`;
    
    if (level === "warn") {
      this.warn(component, message, data);
    } else {
      this.info(component, message, data);
    }
  }
}

export const logger = Logger.getInstance();

/**
 * Create a component-specific logger
 */
export function createLogger(component: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) => logger.debug(component, message, data),
    info: (message: string, data?: Record<string, unknown>) => logger.info(component, message, data),
    warn: (message: string, data?: Record<string, unknown>, error?: Error) => 
      logger.warn(component, message, data, error),
    error: (message: string, error?: Error, data?: Record<string, unknown>) => 
      logger.error(component, message, error, data),
    logRequest: (method: string, path: string, data?: { userId?: string; sessionId?: string }) =>
      logger.logRequest(component, method, path, data),
    logResponse: (method: string, path: string, statusCode: number, durationMs: number, data?: { error?: boolean }) =>
      logger.logResponse(component, method, path, statusCode, durationMs, data)
  };
}
