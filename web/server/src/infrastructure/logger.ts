import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Centralized logging for Kanban Code — writes to ~/.kanban-code/logs/kanban-code.log.
 * Fire-and-forget. Use from anywhere in the server.
 *
 * Swift source: Sources/KanbanCodeCore/Infrastructure/KanbanCodeLog.swift
 * Spec: Section 7 (Infrastructure)
 *
 * Format: [ISO8601] [LEVEL] [subsystem] message
 */

const kanbanBase = process.env.KANBAN_BASE ?? path.join(os.homedir(), '.kanban-code-web');
let logPath = path.join(kanbanBase, 'logs', 'kanban-code.log');

// Ensure log directory exists
try {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
} catch {
  // ignore — will fail on write if truly broken
}

const logToStdout = process.env.KANBAN_LOG_STDOUT !== '0';

function write(level: string, subsystem: string, message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] [${subsystem}] ${message}\n`;

  // Write to log file (fire-and-forget)
  fs.appendFile(logPath, line, () => {});

  // Also write to stdout/stderr for terminal visibility
  if (logToStdout) {
    if (level === 'ERROR') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }
}

export function info(subsystem: string, message: string): void {
  write('INFO', subsystem, message);
}

export function warn(subsystem: string, message: string): void {
  write('WARN', subsystem, message);
}

export function error(subsystem: string, message: string): void {
  write('ERROR', subsystem, message);
}

/** Get the current log path. */
export function getLogPath(): string {
  return logPath;
}

/** Override the log path (for testing). */
export function _setLogPath(newPath: string): void {
  logPath = newPath;
  try { fs.mkdirSync(path.dirname(newPath), { recursive: true }); } catch { /* ignore */ }
}
