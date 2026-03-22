import type { Session } from '@kanban-code/shared';

/** Port for discovering coding assistant sessions across all projects. */
export interface SessionDiscovery {
  discoverSessions(): Promise<Session[]>;
  discoverNewOrModified(since: Date): Promise<Session[]>;
}
