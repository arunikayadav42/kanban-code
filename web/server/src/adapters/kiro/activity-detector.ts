import fs from 'fs';
import type { ActivityState } from '@kanban-code/shared';
import type { ActivityDetector, HookEvent } from '../../domain/ports/activity-detector.js';

/**
 * Detects Kiro CLI session activity using hooks and SQLite file mtime polling.
 *
 * Hook events:
 *   userPromptSubmit -> actively_working
 *   stop / afterAgent -> needs_attention
 *   sessionStart / agentSpawn -> idle_waiting
 *   sessionEnd -> ended
 *
 * Polling fallback: checks SQLite database file mtime.
 *   < activeThreshold (2 min) -> actively_working
 *   < attentionThreshold (5 min) -> needs_attention
 *   < 1 hour -> idle_waiting
 *   < 24 hours -> ended
 *   >= 24 hours -> stale
 *
 * Hook states have a 5-minute timeout before downgrade.
 */

/**
 * Normalize Kiro event names to the canonical names the orchestrator understands.
 */
function normalizeEventName(name: string): string {
  switch (name) {
    case 'AfterAgent': return 'Stop';
    case 'BeforeAgent': return 'UserPromptSubmit';
    case 'userPromptSubmit': return 'UserPromptSubmit';
    case 'stop': return 'Stop';
    case 'agentSpawn': return 'SessionStart';
    case 'sessionStart': return 'SessionStart';
    case 'sessionEnd': return 'SessionEnd';
    default: return name;
  }
}

export class KiroActivityDetector implements ActivityDetector {
  /** Cached activity states from the last poll. */
  private polledStates = new Map<string, ActivityState>();

  /** Hook-based states: tracks the last hook event per session. */
  private hookStates = new Map<string, ActivityState>();

  /** Timestamp of the last hook event per session (for timeout detection). */
  private lastEventTime = new Map<string, number>();

  /** Thresholds (seconds) for activity detection. */
  private readonly activeThreshold: number;
  private readonly attentionThreshold: number;

  /** Path to the Kiro SQLite database (for mtime polling). */
  private readonly dbPath: string | null;

  constructor(
    activeThreshold = 120,
    attentionThreshold = 300,
    dbPath?: string | null,
  ) {
    this.activeThreshold = activeThreshold;
    this.attentionThreshold = attentionThreshold;
    this.dbPath = dbPath ?? null;
  }

  // MARK: - ActivityDetector

  async handleHookEvent(event: HookEvent): Promise<void> {
    const timestamp = new Date(event.timestamp).getTime();
    this.lastEventTime.set(event.sessionId, isNaN(timestamp) ? Date.now() : timestamp);

    const normalized = normalizeEventName(event.eventName);

    switch (normalized) {
      case 'UserPromptSubmit':
        this.hookStates.set(event.sessionId, 'actively_working');
        break;
      case 'SessionStart':
        this.hookStates.set(event.sessionId, 'idle_waiting');
        break;
      case 'Stop':
        this.hookStates.set(event.sessionId, 'needs_attention');
        break;
      case 'SessionEnd':
        this.hookStates.set(event.sessionId, 'ended');
        break;
      case 'Notification':
        this.hookStates.set(event.sessionId, 'needs_attention');
        break;
      default:
        break;
    }
  }

  async pollActivity(
    sessionPaths: Record<string, string>,
  ): Promise<Record<string, ActivityState>> {
    const states: Record<string, ActivityState> = {};

    for (const [sessionId, filePath] of Object.entries(sessionPaths)) {
      // Prefer hook-based state if available and recent
      const hookState = this.hookStates.get(sessionId);
      if (hookState != null) {
        if (
          hookState === 'actively_working' &&
          this.lastEventTime.has(sessionId)
        ) {
          const lastTime = this.lastEventTime.get(sessionId)!;
          const elapsed = (Date.now() - lastTime) / 1000;
          if (elapsed > this.attentionThreshold) {
            this.hookStates.set(sessionId, 'needs_attention');
            states[sessionId] = 'needs_attention';
          } else {
            states[sessionId] = hookState;
          }
        } else {
          states[sessionId] = hookState;
        }
        continue;
      }

      // Fall back to file polling (uses the SQLite DB path or the passed filePath)
      const pathToCheck = this.dbPath ?? filePath;

      let mtime: Date;
      try {
        const stat = fs.statSync(pathToCheck);
        mtime = stat.mtime;
      } catch {
        states[sessionId] = 'ended';
        continue;
      }

      const timeSinceModified = (Date.now() - mtime.getTime()) / 1000;

      if (timeSinceModified < this.activeThreshold) {
        states[sessionId] = 'actively_working';
      } else if (timeSinceModified < this.attentionThreshold) {
        states[sessionId] = 'needs_attention';
      } else if (timeSinceModified < 3600) {
        states[sessionId] = 'idle_waiting';
      } else if (timeSinceModified < 86400) {
        states[sessionId] = 'ended';
      } else {
        states[sessionId] = 'stale';
      }
    }

    // Cache for activityState lookups
    for (const [id, state] of Object.entries(states)) {
      this.polledStates.set(id, state);
    }

    return states;
  }

  async activityState(sessionId: string): Promise<ActivityState> {
    return (
      this.hookStates.get(sessionId) ??
      this.polledStates.get(sessionId) ??
      'stale'
    );
  }

  async resolvePendingStops(): Promise<string[]> {
    return [];
  }
}
