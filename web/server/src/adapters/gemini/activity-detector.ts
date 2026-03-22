import fs from 'fs';
import type { ActivityState } from '@kanban-code/shared';
import type { ActivityDetector, HookEvent } from '../../domain/ports/activity-detector.js';

/**
 * Detects Gemini CLI session activity using both hooks and file modification time polling.
 *
 * Key difference from Claude's detector: polling CAN return actively_working if
 * file was modified within the active threshold (< 2 min by default).
 * Hook states have a 5-min timeout before downgrade.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Gemini/GeminiActivityDetector.swift
 *
 * Note: Swift uses actor isolation. Node.js is single-threaded so we use
 * a plain class -- all operations are naturally serialized.
 */

/**
 * Normalize Gemini event names to the canonical names the orchestrator understands.
 * Mirrors HookManager.normalizeEventName in Swift.
 */
function normalizeEventName(name: string): string {
  switch (name) {
    case 'AfterAgent': return 'Stop';
    case 'BeforeAgent': return 'UserPromptSubmit';
    default: return name;
  }
}

export class GeminiActivityDetector implements ActivityDetector {
  /** Cached activity states from the last poll. */
  private polledStates = new Map<string, ActivityState>();

  /** Hook-based states: tracks the last hook event per session. */
  private hookStates = new Map<string, ActivityState>();

  /** Timestamp of the last hook event per session (for timeout detection). */
  private lastEventTime = new Map<string, number>();

  /** Thresholds (seconds) for activity detection. */
  private readonly activeThreshold: number;   // < this = actively_working
  private readonly attentionThreshold: number; // < this = needs_attention

  constructor(activeThreshold = 120, attentionThreshold = 300) {
    this.activeThreshold = activeThreshold;
    this.attentionThreshold = attentionThreshold;
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
        // Check for timeout: if actively working for > attentionThreshold without a new event, downgrade
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

      // Fall back to file polling
      let mtime: Date;
      try {
        const stat = fs.statSync(filePath);
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
