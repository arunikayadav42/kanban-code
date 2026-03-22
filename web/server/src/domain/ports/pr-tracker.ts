import type { PullRequest } from '@kanban-code/shared';

/** Port for tracking GitHub pull requests. */
export interface PRTrackerPort {
  fetchPRs(repoRoot: string): Promise<Record<string, PullRequest>>;
  enrichPRDetails(repoRoot: string, prs: Record<string, PullRequest>): Promise<Record<string, PullRequest>>;
  fetchPRBody(repoRoot: string, prNumber: number): Promise<string | null>;
  isAvailable(): Promise<boolean>;
}
