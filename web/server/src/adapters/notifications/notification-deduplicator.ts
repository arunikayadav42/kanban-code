/**
 * Anti-duplicate logic for notifications.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Notifications/NotificationDeduplicator.swift
 * Swift tests: Tests/KanbanCodeCoreTests/NotificationDedupTests.swift (all ported)
 * Spec: Section 7.6 (dedupWindow=62s)
 *
 * Mirrors claude-pushover's exact approach, adapted for batch processing:
 * - Stop: sleep 1s, check if user prompted within 1s after stop -> if not, send (with 62s dedup)
 * - Notification: send if not within 62s dedup window
 * - UserPromptSubmit: record timestamp for debounce check
 *
 * Key difference from claude-pushover: we process events in batches (not one-per-process),
 * so we use EVENT TIMESTAMPS (from the hook script) instead of wall-clock Date() to avoid
 * batch processing artifacts where future events in the batch pollute earlier events.
 */
export class NotificationDeduplicator {
  /** Per-session last notification event time (for 62s dedup window). */
  private readonly lastNotified = new Map<string, Date>();
  /** Per-session last prompt event time (for Stop debounce). */
  private readonly lastPromptTime = new Map<string, Date>();
  /** Dedup window in seconds. */
  private readonly dedupWindow: number;

  constructor(dedupWindow: number = 62) {
    this.dedupWindow = dedupWindow;
  }

  /** Record a UserPromptSubmit using the event's actual timestamp. */
  recordPrompt(sessionId: string, at: Date): void {
    this.lastPromptTime.set(sessionId, at);
  }

  /**
   * Check if user prompted within 1s after a Stop event.
   * Uses event timestamps to correctly handle batch processing:
   * only blocks if the prompt came within 1s AFTER the stop
   * (matching claude-pushover's 1s sleep window).
   */
  hasPromptedWithin(
    sessionId: string,
    after: Date,
    window: number = 1.0,
  ): boolean {
    const promptTime = this.lastPromptTime.get(sessionId);
    if (!promptTime) return false;
    const promptMs = promptTime.getTime();
    const stopMs = after.getTime();
    return promptMs > stopMs && promptMs <= stopMs + window * 1000;
  }

  /**
   * Check 62s dedup window using event timestamps.
   * Returns true if notification should be sent.
   */
  shouldNotify(sessionId: string, eventTime: Date): boolean {
    const lastTime = this.lastNotified.get(sessionId);
    if (lastTime) {
      const elapsedSeconds =
        (eventTime.getTime() - lastTime.getTime()) / 1000;
      if (elapsedSeconds < this.dedupWindow) return false;
    }
    this.lastNotified.set(sessionId, eventTime);
    return true;
  }

  /** Clear all state (used on startup to discard stale events). */
  clearAllPending(): void {
    this.lastPromptTime.clear();
  }
}
