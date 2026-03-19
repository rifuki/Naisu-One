/**
 * Structured logger utility — console + daily file output
 * Files written to: logs/agent.log.YYYY-MM-DD
 */
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
  error?: Error;
}

// ─── File logging ─────────────────────────────────────────────────────────────

const LOGS_DIR = resolve("logs");

function ensureLogsDir(): void {
  try {
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
  } catch { /* ignore */ }
}

function writeToFile(level: LogLevel, component: string, message: string, data?: Record<string, unknown>, error?: Error): void {
  try {
    ensureLogsDir();
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filePath = join(LOGS_DIR, `agent.log.${date}`);
    const entry: Record<string, unknown> = {
      t: new Date().toISOString(),
      l: level,
      c: component,
      msg: message,
    };
    if (data && Object.keys(data).length > 0) entry.data = data;
    if (error) entry.err = { msg: error.message, stack: error.stack };
    appendFileSync(filePath, JSON.stringify(entry) + "\n");
  } catch { /* file logging must never crash the app */ }
}

// ─── Logger class ─────────────────────────────────────────────────────────────

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
      log += ` | ${JSON.stringify(data)}`;
    }

    if (error) {
      log += ` | ERR: ${error.message}`;
      if (error.stack) {
        log += `\n${error.stack}`;
      }
    }

    return log;
  }

  debug(component: string, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog("debug")) return;
    console.debug(this.formatMessage("debug", component, message, data));
    writeToFile("debug", component, message, data);
  }

  info(component: string, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog("info")) return;
    console.info(this.formatMessage("info", component, message, data));
    writeToFile("info", component, message, data);
  }

  warn(component: string, message: string, data?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog("warn")) return;
    console.warn(this.formatMessage("warn", component, message, data, error));
    writeToFile("warn", component, message, data, error);
  }

  error(component: string, message: string, error?: Error, data?: Record<string, unknown>): void {
    if (!this.shouldLog("error")) return;
    console.error(this.formatMessage("error", component, message, data, error));
    writeToFile("error", component, message, data, error);
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
