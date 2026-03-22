import fs from 'fs';
import type { ActivityState } from '@kanban-code/shared';
import type { ActivityDetector, HookEvent } from '../../domain/ports/activity-detector.js';

/**
 * Detects Claude Code session activity from hook events and .jsonl file polling.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/ClaudeCode/ClaudeCodeActivityDetector.swift
 * Spec: Section 7.6 (Timing Constants), Section 7.8 (Activity Detection Invariants)
 *
 * Key invariant: pollActivity() NEVER returns 'actively_working'.
 * Only hook events (UserPromptSubmit) can promote a session to 'actively_working'.
 */
export class ClaudeCodeActivityDetector implements ActivityDetector {
  /** Stores the last known event per session. */
  private lastEvents = new Map<string, HookEvent>();
  /** Stores the last polled activity state per session. */
  private polledStates = new Map<string, ActivityState>();
  /** Session transcript paths (populated by pollActivity, used for direct mtime checks). */
  private sessionPaths = new Map<string, string>();
  /** Sessions that received a Stop but might get a follow-up prompt. */
  private pendingStops = new Map<string, number>();

  /** Delay before treating a Stop as final (seconds). */
  private readonly stopDelay: number;
  /** Timeout (seconds) before treating a hook-active session as timed out. */
  private readonly activeTimeout: number;

  constructor(options?: { stopDelay?: number; activeTimeout?: number }) {
    this.stopDelay = options?.stopDelay ?? 1.0;
    this.activeTimeout = options?.activeTimeout ?? 300;
  }

  async handleHookEvent(event: HookEvent): Promise<void> {
    this.lastEvents.set(event.sessionId, event);

    if (event.eventName === 'Stop') {
      // Record stop -- will be resolved after stopDelay if no follow-up prompt
      this.pendingStops.set(event.sessionId, new Date(event.timestamp).getTime());
    } else if (event.eventName === 'UserPromptSubmit' || event.eventName === 'SessionStart') {
      // Clear pending stops on any new activity
      this.pendingStops.delete(event.sessionId);
    }
  }

  async pollActivity(sessionPaths: Record<string, string>): Promise<Record<string, ActivityState>> {
    // Cache paths for direct mtime checks in activityState()
    for (const [id, filePath] of Object.entries(sessionPaths)) {
      this.sessionPaths.set(id, filePath);
    }

    const states: Record<string, ActivityState> = {};

    for (const [sessionId, filePath] of Object.entries(sessionPaths)) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        states[sessionId] = 'ended';
        continue;
      }

      const mtime = stat.mtimeMs;
      const timeSinceModifiedSec = (Date.now() - mtime) / 1000;

      // Polling NEVER returns 'actively_working' -- only hooks can confirm active work.
      // This prevents false "In Progress" cards for sessions started externally.
      if (timeSinceModifiedSec < this.activeTimeout) {
        states[sessionId] = 'idle_waiting';
      } else if (timeSinceModifiedSec < 3600) {
        states[sessionId] = 'needs_attention';
      } else if (timeSinceModifiedSec < 86400) {
        states[sessionId] = 'ended';
      } else {
        states[sessionId] = 'stale';
      }
    }

    // Store poll results for use by activityState()
    for (const [id, state] of Object.entries(states)) {
      this.polledStates.set(id, state);
    }

    return states;
  }

  async activityState(sessionId: string): Promise<ActivityState> {
    // Check hook-based detection first
    const lastEvent = this.lastEvents.get(sessionId);
    if (!lastEvent) {
      // No hook events -- use polled state if available.
      // Polling never returns 'actively_working', so sessions without hooks
      // never appear in "In Progress".
      return this.polledStates.get(sessionId) ?? 'stale';
    }

    switch (lastEvent.eventName) {
      case 'UserPromptSubmit': {
        // After a prompt, Claude is actively working. Stay in this state until:
        // 1. A Stop hook fires
        // 2. File stale >3s AND last jsonl line is "[Request interrupted by user]"
        //    -> Ctrl+C detected instantly without waiting for 5-minute timeout
        // 3. File hasn't been modified for >5 minutes (safety net timeout)
        // 4. No file path cached -> fall back to hook age
        const filePath = this.sessionPaths.get(sessionId);
        if (!filePath) {
          const timeSinceSec = (Date.now() - new Date(lastEvent.timestamp).getTime()) / 1000;
          if (timeSinceSec > this.activeTimeout) {
            return this.polledStates.get(sessionId) ?? 'needs_attention';
          }
          return 'actively_working';
        }

        const fileAge = getFileAgeSec(filePath);
        if (fileAge === null) {
          return 'actively_working';
        }

        // Safety net: 5-minute timeout for killed processes / abandoned sessions
        if (fileAge > this.activeTimeout) {
          return 'needs_attention';
        }

        // Fast Ctrl+C detection: file stopped changing >3s ago, check last line
        if (fileAge > 3 && lastLineContainsInterrupt(filePath)) {
          return 'needs_attention';
        }

        return 'actively_working';
      }

      case 'SessionStart':
        // Session opened or resumed -- Claude is at the prompt waiting for input.
        return 'idle_waiting';

      case 'Stop':
        // Stop is the definitive signal -- immediately needs attention
        return 'needs_attention';

      case 'SessionEnd':
        return 'ended';

      case 'Notification':
        return 'needs_attention';

      default:
        // Unknown hook events -- use polled state, never promote to activelyWorking
        return this.polledStates.get(sessionId) ?? 'idle_waiting';
    }
  }

  async resolvePendingStops(): Promise<string[]> {
    const now = Date.now();
    const resolved: string[] = [];

    for (const [sessionId, stopTimeMs] of this.pendingStops) {
      if ((now - stopTimeMs) / 1000 >= this.stopDelay) {
        resolved.push(sessionId);
      }
    }

    for (const id of resolved) {
      this.pendingStops.delete(id);
    }

    return resolved;
  }
}

/**
 * Quick mtime check -- returns seconds since file was last modified, or null on error.
 */
function getFileAgeSec(filePath: string): number | null {
  try {
    const stat = fs.statSync(filePath);
    return (Date.now() - stat.mtimeMs) / 1000;
  } catch {
    return null;
  }
}

/**
 * Check if the last line of a .jsonl file contains "[Request interrupted by user]".
 * Claude Code writes this synthetic user message on Ctrl+C.
 * Reads from the end of the file for efficiency (avoids reading entire file).
 */
function lastLineContainsInterrupt(filePath: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return false;
  }

  try {
    const stat = fs.fstatSync(fd);
    const fileSize = stat.size;
    const readSize = Math.min(4096, fileSize);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, fileSize - readSize);

    const tail = buffer.toString('utf-8');
    // Find the last non-empty line
    const lines = tail.split('\n').filter(l => l.length > 0);
    const lastLine = lines[lines.length - 1];
    if (!lastLine) return false;

    return lastLine.includes('Request interrupted by user');
  } catch {
    return false;
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}
