import type { ActivityState } from '@kanban-code/shared';

/** A hook event received from the AI CLI's hook system. */
export interface HookEvent {
  sessionId: string;
  eventName: string; // UserPromptSubmit, Stop, Notification, SessionStart, SessionEnd
  transcriptPath?: string | null;
  notificationType?: string | null;
  timestamp: string; // ISO8601
}

/** Port for detecting session activity state (hooks + polling). */
export interface ActivityDetector {
  handleHookEvent(event: HookEvent): Promise<void>;
  pollActivity(sessionPaths: Record<string, string>): Promise<Record<string, ActivityState>>;
  activityState(sessionId: string): Promise<ActivityState>;
  resolvePendingStops(): Promise<string[]>;
}
