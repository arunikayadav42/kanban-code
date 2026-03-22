/** Sync session status. */
export type SyncStatus = 'watching' | 'staging' | 'conflicts' | 'paused' | 'error' | 'not_running';

/** Port for managing file synchronization (e.g., Mutagen). */
export interface SyncManagerPort {
  startSync(localPath: string, remotePath: string, name: string, ignores: string[]): Promise<void>;
  stopSync(name: string): Promise<void>;
  flushSync(): Promise<void>;
  status(): Promise<Record<string, SyncStatus>>;
  rawStatus(): Promise<string>;
  isAvailable(): Promise<boolean>;
}
