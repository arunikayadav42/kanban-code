/**
 * The coordination record — a card on the board with independently optional typed links.
 * Stored in ~/.kanban-code/links.json.
 *
 * Swift source: Sources/KanbanCodeCore/Domain/Entities/Link.swift (565 lines)
 * Spec: Sections 7.4, 7.5, 7.8 (Card Lifecycle/Merge Invariants)
 */

import type { KanbanCodeColumn } from './columns.js';
import type { CodingAssistant } from './coding-assistant.js';
import { ALL_ASSISTANTS } from './coding-assistant.js';
import type { PRStatus, CheckRun } from './pr-status.js';
import { getPRStatusPriority } from './pr-status.js';

// MARK: - Typed Link Sub-Structs

export interface SessionLink {
  sessionId: string;
  sessionPath?: string | null;
  sessionNumber?: number | null;
}

export interface TmuxLink {
  sessionName: string;
  extraSessions?: string[] | null;
  tabNames?: Record<string, string> | null;
  isShellOnly?: boolean | null;
  isPrimaryDead?: boolean | null;
}

/** All session names (primary + extras). */
export function getTmuxAllSessionNames(tmux: TmuxLink): string[] {
  const result = [tmux.sessionName];
  if (tmux.extraSessions) result.push(...tmux.extraSessions);
  return result;
}

/** Total count of terminals. */
export function getTmuxTerminalCount(tmux: TmuxLink): number {
  return getTmuxAllSessionNames(tmux).length;
}

export interface WorktreeLink {
  path: string;
  branch?: string | null;
}

export interface PRLink {
  number: number;
  url?: string | null;
  status?: PRStatus | null;
  unresolvedThreads?: number | null;
  title?: string | null;
  body?: string | null;
  approvalCount?: number | null;
  checkRuns?: CheckRun[] | null;
  firstUnresolvedThreadURL?: string | null;
  mergeStateStatus?: string | null;
}

export interface IssueLink {
  number: number;
  url?: string | null;
  body?: string | null;
  title?: string | null;
}

export interface QueuedPrompt {
  id: string;
  body: string;
  sendAutomatically: boolean;
  imagePaths?: string[] | null;
}

// MARK: - Card Label

export type CardLabel = 'SESSION' | 'WORKTREE' | 'ISSUE' | 'PR' | 'TASK';

// MARK: - Link Source

export type LinkSource = 'discovered' | 'hook' | 'github_issue' | 'manual';

// MARK: - Manual Overrides

export interface ManualOverrides {
  worktreePath: boolean;
  tmuxSession: boolean;
  name: boolean;
  column: boolean;
  prLink: boolean;
  issueLink: boolean;
  dismissedPRs?: number[] | null;
  branchWatermark?: number | null;
}

export function createDefaultManualOverrides(): ManualOverrides {
  return {
    worktreePath: false,
    tmuxSession: false,
    name: false,
    column: false,
    prLink: false,
    issueLink: false,
  };
}

/** Whether auto-discovered branch data should be ignored for this card. */
export function isBranchDiscoveryBlocked(overrides: ManualOverrides): boolean {
  return overrides.branchWatermark != null || overrides.worktreePath;
}

/** Whether a specific PR number has been dismissed by the user. */
export function isPRDismissed(overrides: ManualOverrides, number: number): boolean {
  // Legacy: prLink == true means all PRs were dismissed (old format)
  if (overrides.prLink) return true;
  return overrides.dismissedPRs?.includes(number) === true;
}

// MARK: - Content Block (for history/checkpoint)

export type ContentBlockKind =
  | { type: 'text' }
  | { type: 'toolUse'; name: string; input: Record<string, string> }
  | { type: 'toolResult'; toolName: string | null }
  | { type: 'thinking' };

export interface ContentBlock {
  kind: ContentBlockKind;
  text: string;
}

// MARK: - Conversation Turn

export interface ConversationTurn {
  index: number;
  lineNumber: number;
  role: string; // "user" or "assistant"
  textPreview: string;
  timestamp?: string | null;
  contentBlocks: ContentBlock[];
}

// MARK: - Link (Card Entity)

export interface Link {
  id: string;

  // Card-level properties
  name?: string | null;
  projectPath?: string | null;
  column: KanbanCodeColumn;
  createdAt: string; // ISO8601
  updatedAt: string; // ISO8601
  lastActivity?: string | null; // ISO8601
  lastOpenedAt?: string | null; // ISO8601
  manualOverrides: ManualOverrides;
  manuallyArchived: boolean;
  source: LinkSource;
  promptBody?: string | null;
  promptImagePaths?: string[] | null;

  // Typed links — each independently optional
  sessionLink?: SessionLink | null;
  tmuxLink?: TmuxLink | null;
  worktreeLink?: WorktreeLink | null;
  prLinks: PRLink[];
  issueLink?: IssueLink | null;
  queuedPrompts?: QueuedPrompt[] | null;

  // Branch discovery
  discoveredBranches?: string[] | null;
  discoveredRepos?: Record<string, string> | null;

  // Metadata
  isRemote: boolean;
  sortOrder?: number | null;
  assistant?: CodingAssistant | null;
  isLaunching?: boolean | null;

  // Server-computed display fields (set in buildEventPayload, never persisted)
  displayTitle?: string;
  cardLabel?: CardLabel;
  worstPRStatus?: PRStatus | null;
  projectName?: string | null;
  effectiveAssistant?: string;
  cardType?: 'sessions' | 'tasks' | 'issues' | 'other';
  cardSourceLabel?: CardLabel | null;
}

// MARK: - Link Computed Properties

/** The effective assistant (never null). Defaults to the first registered assistant. */
export function getEffectiveAssistant(link: Link): CodingAssistant {
  return link.assistant ?? ALL_ASSISTANTS[0];
}

/** Best display title: name → promptBody → branch → PR title → session ID → id. */
export function getDisplayTitle(link: Link): string {
  if (link.name && link.name.length > 0) return link.name;
  if (link.promptBody && link.promptBody.length > 0) return link.promptBody.substring(0, 100);
  if (link.worktreeLink?.branch && link.worktreeLink.branch.length > 0) return link.worktreeLink.branch;
  if (link.prLinks[0]?.title && link.prLinks[0].title.length > 0) return link.prLinks[0].title;
  if (link.sessionLink?.sessionId) return link.sessionLink.sessionId;
  return link.id;
}

/** Primary PR (first in array, or null). Backward-compat shorthand. */
export function getPrimaryPR(link: Link): PRLink | null {
  return link.prLinks[0] ?? null;
}

/** The single open PR eligible for merge, or null if 0 or 2+ open PRs. */
export function getMergeablePR(link: Link): PRLink | null {
  const open = link.prLinks.filter(pr => pr.status !== 'merged' && pr.status !== 'closed');
  return open.length === 1 ? open[0] : null;
}

/** Worst PR status across all PRs (highest urgency = lowest priority number). */
export function getWorstPRStatus(link: Link): PRStatus | null {
  const statuses = link.prLinks.map(pr => pr.status).filter((s): s is PRStatus => s != null);
  if (statuses.length === 0) return null;
  // PRStatus priority: lower number = higher urgency. min() in Swift = most urgent.
  return statuses.reduce((worst, current) =>
    getPRStatusPriority(current) < getPRStatusPriority(worst) ? current : worst
  );
}

/** True if ALL PRs are merged or closed. */
export function getAllPRsDone(link: Link): boolean {
  const prs = link.prLinks ?? [];
  return prs.length > 0 && prs.every(pr => pr.status === 'merged' || pr.status === 'closed');
}

/** The primary label for this card based on which links are present. Priority: session > worktree > issue > pr > task. */
export function getCardLabel(link: Link): CardLabel {
  if (link.sessionLink) return 'SESSION';
  if (link.worktreeLink) return 'WORKTREE';
  if (link.issueLink) return 'ISSUE';
  if (link.prLinks.length > 0) return 'PR';
  return 'TASK';
}

// MARK: - Backward-compat computed properties

export function getSessionId(link: Link): string | null { return link.sessionLink?.sessionId ?? null; }
export function getSessionPath(link: Link): string | null { return link.sessionLink?.sessionPath ?? null; }
export function getTmuxSession(link: Link): string | null { return link.tmuxLink?.sessionName ?? null; }
export function getWorktreePath(link: Link): string | null { return link.worktreeLink?.path ?? null; }
export function getWorktreeBranch(link: Link): string | null { return link.worktreeLink?.branch ?? null; }
export function getGithubIssue(link: Link): number | null { return link.issueLink?.number ?? null; }
export function getGithubPR(link: Link): number | null { return link.prLinks[0]?.number ?? null; }
export function getSessionNumber(link: Link): number | null { return link.sessionLink?.sessionNumber ?? null; }
export function getIssueBody(link: Link): string | null { return link.issueLink?.body ?? link.promptBody ?? null; }

export function getProjectName(link: Link): string | null {
  return link.projectPath ? link.projectPath.split('/').filter(Boolean).pop() ?? null : null;
}

/** The origin-based label for this card. Returns TASK for manual cards, ISSUE for github issues, null for auto-discovered. */
export function getCardSourceLabel(link: Link): CardLabel | null {
  if (link.source === 'manual') return 'TASK';
  if (link.source === 'github_issue') return 'ISSUE';
  return null;
}

export function getCardType(link: Link): 'sessions' | 'tasks' | 'issues' | 'other' {
  if (link.sessionLink != null) return 'sessions';
  if (link.source === 'manual') return 'tasks';
  if (link.source === 'github_issue') return 'issues';
  return 'other';
}

export function enrichLink(link: Link): Link {
  return {
    ...link,
    displayTitle: getDisplayTitle(link),
    cardLabel: getCardLabel(link),
    worstPRStatus: getWorstPRStatus(link),
    projectName: getProjectName(link),
    effectiveAssistant: getEffectiveAssistant(link),
    cardType: getCardType(link),
    cardSourceLabel: getCardSourceLabel(link),
  };
}

export function enrichLinks(links: Record<string, Link>): Record<string, Link> {
  const result: Record<string, Link> = {};
  for (const [id, link] of Object.entries(links)) {
    result[id] = enrichLink(link);
  }
  return result;
}

export function validateColumnMove(link: Link, toColumn: KanbanCodeColumn): string | null {
  if (toColumn === 'in_progress' && link.tmuxLink != null) {
    return 'Cannot move to In Progress: session is already running';
  }
  if (toColumn === 'in_review' && link.prLinks.length === 0) {
    return 'Cannot move to In Review: no pull requests';
  }
  if (toColumn === 'done' && !link.prLinks.some(pr => pr.status === 'merged')) {
    return 'Cannot move to Done: no merged pull request';
  }
  return null;
}

// MARK: - Merge Validation

/** Check if two cards can be merged. Returns null if allowed, or an error message if not. */
export function mergeBlocked(source: Link, target: Link): string | null {
  if (source.id === target.id) return 'Cannot merge a card with itself';
  if (source.sessionLink && target.sessionLink) return 'Cannot merge: both cards have sessions';
  if (source.tmuxLink && target.tmuxLink) return 'Cannot merge: both cards have terminals';
  if (source.issueLink && target.issueLink
    && (source.issueLink.number !== target.issueLink.number || source.issueLink.url !== target.issueLink.url)) {
    return 'Cannot merge: both cards have different issues';
  }
  if (source.worktreeLink && target.worktreeLink
    && (source.worktreeLink.path !== target.worktreeLink.path || source.worktreeLink.branch !== target.worktreeLink.branch)) {
    return 'Cannot merge: both cards have different worktrees';
  }
  return null;
}

// MARK: - Create Link

export function createLink(overrides: Partial<Link> & { id: string }): Link {
  return {
    column: 'all_sessions',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    manualOverrides: createDefaultManualOverrides(),
    manuallyArchived: false,
    source: 'discovered',
    prLinks: [],
    isRemote: false,
    ...overrides,
  };
}

// MARK: - JSON Deserialization (backward-compatible)

/**
 * Parse a link from JSON, handling both new nested format and old flat format.
 * Mirrors the Swift init(from decoder:) exactly.
 */
export function parseLinkFromJSON(json: Record<string, unknown>): Link {
  // Session link: try nested first, fallback to flat
  let sessionLink: SessionLink | null = null;
  if (json.sessionLink && typeof json.sessionLink === 'object') {
    sessionLink = json.sessionLink as SessionLink;
  } else if (json.sessionId && typeof json.sessionId === 'string') {
    sessionLink = {
      sessionId: json.sessionId as string,
      sessionPath: (json.sessionPath as string) ?? null,
      sessionNumber: (json.sessionNumber as number) ?? null,
    };
  }

  // Tmux link
  let tmuxLink: TmuxLink | null = null;
  if (json.tmuxLink && typeof json.tmuxLink === 'object') {
    tmuxLink = json.tmuxLink as TmuxLink;
  } else if (json.tmuxSession && typeof json.tmuxSession === 'string') {
    tmuxLink = { sessionName: json.tmuxSession as string };
  }

  // Worktree link
  let worktreeLink: WorktreeLink | null = null;
  if (json.worktreeLink && typeof json.worktreeLink === 'object') {
    worktreeLink = json.worktreeLink as WorktreeLink;
  } else {
    const wp = json.worktreePath as string | undefined;
    const wb = json.worktreeBranch as string | undefined;
    if (wp) {
      worktreeLink = { path: wp, branch: wb ?? null };
    } else if (wb) {
      worktreeLink = { path: '', branch: wb };
    }
  }

  // PR links: try array first, fallback to singular prLink, fallback to legacy githubPR
  let prLinks: PRLink[] = [];
  if (Array.isArray(json.prLinks)) {
    prLinks = json.prLinks as PRLink[];
  } else if (json.prLink && typeof json.prLink === 'object') {
    prLinks = [json.prLink as PRLink];
  } else if (json.githubPR && typeof json.githubPR === 'number') {
    prLinks = [{ number: json.githubPR as number }];
  }

  // Issue link
  let issueLink: IssueLink | null = null;
  let promptBody = (json.promptBody as string) ?? null;
  if (json.issueLink && typeof json.issueLink === 'object') {
    issueLink = json.issueLink as IssueLink;
  } else if (json.githubIssue && typeof json.githubIssue === 'number') {
    const body = json.issueBody as string | undefined;
    issueLink = { number: json.githubIssue as number, body: body ?? null };
  } else {
    // Migrate issueBody to promptBody for manual tasks
    if (!promptBody && json.issueBody) {
      promptBody = json.issueBody as string;
    }
  }

  const manualOverrides: ManualOverrides = json.manualOverrides
    ? { ...createDefaultManualOverrides(), ...(json.manualOverrides as Partial<ManualOverrides>) }
    : createDefaultManualOverrides();

  return {
    id: json.id as string,
    name: (json.name as string) ?? null,
    projectPath: (json.projectPath as string) ?? null,
    column: (json.column as KanbanCodeColumn) ?? 'all_sessions',
    createdAt: (json.createdAt as string) ?? new Date().toISOString(),
    updatedAt: (json.updatedAt as string) ?? new Date().toISOString(),
    lastActivity: (json.lastActivity as string) ?? null,
    lastOpenedAt: (json.lastOpenedAt as string) ?? null,
    manualOverrides,
    manuallyArchived: (json.manuallyArchived as boolean) ?? false,
    source: (json.source as LinkSource) ?? 'discovered',
    promptBody,
    promptImagePaths: (json.promptImagePaths as string[]) ?? null,
    sessionLink,
    tmuxLink,
    worktreeLink,
    prLinks,
    issueLink,
    queuedPrompts: (json.queuedPrompts as QueuedPrompt[]) ?? null,
    discoveredBranches: (json.discoveredBranches as string[]) ?? null,
    discoveredRepos: (json.discoveredRepos as Record<string, string>) ?? null,
    isRemote: (json.isRemote as boolean) ?? false,
    sortOrder: (json.sortOrder as number) ?? null,
    assistant: (json.assistant as CodingAssistant) ?? null,
    isLaunching: (json.isLaunching as boolean) ?? null,
  };
}
