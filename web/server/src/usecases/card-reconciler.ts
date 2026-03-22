import type {
  Link, Session, TmuxSession, Worktree, PullRequest,
} from '@kanban-code/shared';
import {
  createLink, createDefaultManualOverrides, getTmuxAllSessionNames,
  isBranchDiscoveryBlocked, isPRDismissed,
} from '@kanban-code/shared';
import { generate } from '../infrastructure/ksuid.js';
import { info } from '../infrastructure/logger.js';

/**
 * Pure reconciliation logic: matches discovered resources to existing cards,
 * preventing duplicate card creation (the "triplication bug").
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/CardReconciler.swift (457 lines)
 * Spec: Section 7.5 (Card Reconciliation)
 *
 * Responsibilities:
 * - Match discovered sessions to existing cards (by sessionId -> branch -> projectPath+tmux)
 * - Create new cards for truly unmatched sessions
 * - Match discovered worktrees to existing cards (by branch)
 * - Create orphan worktree cards for unmatched worktrees
 * - Add/update PR links via branch matching
 * - Clear dead tmux and worktree links
 *
 * NOT responsible for: column assignment, activity detection, GitHub issue syncing.
 */

// MARK: - DiscoverySnapshot

/** A point-in-time snapshot of all discovered external resources. */
export interface DiscoverySnapshot {
  sessions: Session[];
  tmuxSessions: TmuxSession[];
  didScanTmux: boolean;
  worktrees: Record<string, Worktree[]>; // repoRoot -> worktrees
  pullRequests: Record<string, PullRequest>; // branch -> PR
}

export function createDiscoverySnapshot(overrides?: Partial<DiscoverySnapshot>): DiscoverySnapshot {
  return {
    sessions: [],
    tmuxSessions: [],
    didScanTmux: false,
    worktrees: {},
    pullRequests: {},
    ...overrides,
  };
}

// MARK: - Reconcile

/**
 * Reconcile existing cards with discovered resources.
 * Returns the merged list of links (some updated, some new, some with cleared links).
 */
export function reconcile(existing: Link[], snapshot: DiscoverySnapshot): Link[] {
  const linksById: Record<string, Link> = {};
  for (const link of existing) {
    linksById[link.id] = link;
  }

  // Build reverse indexes for matching
  const cardIdBySessionId: Record<string, string> = {};
  const cardIdByTmuxName: Record<string, string> = {};
  const cardIdsByBranch: Record<string, string[]> = {};

  for (const link of existing) {
    if (link.sessionLink?.sessionId) {
      cardIdBySessionId[link.sessionLink.sessionId] = link.id;
    }
    if (link.tmuxLink) {
      for (const name of getTmuxAllSessionNames(link.tmuxLink)) {
        cardIdByTmuxName[name] = link.id;
      }
    }
    if (link.worktreeLink?.branch) {
      if (!cardIdsByBranch[link.worktreeLink.branch]) cardIdsByBranch[link.worktreeLink.branch] = [];
      cardIdsByBranch[link.worktreeLink.branch].push(link.id);
    }
    // Also index discovered branches for PR matching
    if (link.discoveredBranches) {
      for (const branch of link.discoveredBranches) {
        if (!(cardIdsByBranch[branch]?.includes(link.id) ?? false)) {
          if (!cardIdsByBranch[branch]) cardIdsByBranch[branch] = [];
          cardIdsByBranch[branch].push(link.id);
        }
      }
    }
  }

  // Track which sessions we've matched so we can detect new ones
  const matchedSessionIds = new Set<string>();

  // A. Match sessions to existing cards
  for (const session of snapshot.sessions) {
    const cardId = findCardForSession(
      session,
      cardIdBySessionId,
      cardIdByTmuxName,
      cardIdsByBranch,
      linksById,
    );

    if (cardId != null && linksById[cardId]) {
      let link = { ...linksById[cardId] };

      // Archived cards stay archived -- just mark matched to prevent duplicates
      if (link.manuallyArchived) {
        matchedSessionIds.add(session.id);
        continue;
      }

      // Update existing card with session data
      if (!link.sessionLink) {
        info('reconciler', `Linking session ${session.id.substring(0, 8)} to existing card ${cardId.substring(0, 12)}`);
        link = {
          ...link,
          sessionLink: {
            sessionId: session.id,
            sessionPath: session.jsonlPath,
          },
        };
        cardIdBySessionId[session.id] = link.id;
      } else {
        // Update existing session link
        link = {
          ...link,
          sessionLink: {
            ...link.sessionLink,
            sessionPath: session.jsonlPath,
          },
        };
      }

      link = { ...link, lastActivity: session.modifiedTime };

      // Backfill assistant from session if card doesn't have one yet
      if (link.assistant == null && session.assistant) {
        link = { ...link, assistant: session.assistant };
      }

      if (link.projectPath == null && session.projectPath != null) {
        link = { ...link, projectPath: session.projectPath };
      }

      // If session is in a worktree dir and card doesn't have worktreeLink yet,
      // find the matching worktree in the snapshot to get the correct git branch name.
      if (
        !link.worktreeLink
        && link.isLaunching === true
        && session.projectPath
        && session.projectPath.includes('/.claude/worktrees/')
      ) {
        let branchName: string | null = null;
        // Prefer real git branch from snapshot
        for (const worktrees of Object.values(snapshot.worktrees)) {
          const wt = worktrees.find(w => w.path === session.projectPath);
          if (wt?.branch) {
            branchName = wt.branch.replace('refs/heads/', '');
            break;
          }
        }
        // Fallback: extract from path
        if (!branchName) {
          const marker = '/.claude/worktrees/';
          const idx = session.projectPath.indexOf(marker);
          if (idx !== -1) {
            const afterPrefix = session.projectPath.substring(idx + marker.length);
            branchName = afterPrefix.split('/')[0] ?? null;
          }
        }
        if (branchName && branchName.length > 0) {
          info('reconciler', `Setting worktreeLink from session path: branch=${branchName} on card ${cardId.substring(0, 12)}`);
          link = {
            ...link,
            worktreeLink: { path: session.projectPath, branch: branchName },
          };
          if (!cardIdsByBranch[branchName]) cardIdsByBranch[branchName] = [];
          cardIdsByBranch[branchName].push(cardId);
        }
      }

      linksById[cardId] = link;
      matchedSessionIds.add(session.id);
    } else {
      info('reconciler', `New session ${session.id.substring(0, 8)} -> new card`);
      // Truly new session -- create discovered card
      const newLink = createLink({
        id: generate(),
        projectPath: session.projectPath,
        column: 'all_sessions',
        lastActivity: session.modifiedTime,
        source: 'discovered',
        assistant: session.assistant,
        sessionLink: {
          sessionId: session.id,
          sessionPath: session.jsonlPath,
        },
      });
      linksById[newLink.id] = newLink;
      cardIdBySessionId[session.id] = newLink.id;
      matchedSessionIds.add(session.id);
    }
  }

  // A2. Update branch index with session gitBranch data.
  for (const session of snapshot.sessions) {
    if (session.gitBranch) {
      const baseName = session.gitBranch.replace('refs/heads/', '');
      if (baseName === 'main' || baseName === 'master') continue;
      const cardId = cardIdBySessionId[session.id];
      if (cardId && !(cardIdsByBranch[baseName]?.includes(cardId) ?? false)) {
        // Skip cards with branch discovery blocked
        if (linksById[cardId]?.manualOverrides && isBranchDiscoveryBlocked(linksById[cardId].manualOverrides)) continue;
        if (!cardIdsByBranch[baseName]) cardIdsByBranch[baseName] = [];
        cardIdsByBranch[baseName].push(cardId);
      }
    }
  }

  // B. Match worktrees to existing cards
  const liveTmuxNames = new Set(snapshot.tmuxSessions.map(s => s.name));
  const didScanTmux = snapshot.didScanTmux;
  const liveWorktreePaths = new Set<string>();
  const didScanWorktrees = Object.keys(snapshot.worktrees).length > 0;

  for (const [repoRoot, worktrees] of Object.entries(snapshot.worktrees)) {
    for (const worktree of worktrees) {
      if (worktree.isBare) continue;
      // Skip the main repo checkout
      if (worktree.path === repoRoot) continue;
      liveWorktreePaths.add(worktree.path);

      if (!worktree.branch) continue;
      const baseName = worktree.branch.replace('refs/heads/', '');
      if (baseName === 'main' || baseName === 'master') continue;

      const existingCardIds = cardIdsByBranch[baseName] ?? [];
      if (existingCardIds.length === 0) {
        // Check if a card is currently launching in this repo
        const launchingEntry = Object.entries(linksById).find(([, link]) =>
          link.isLaunching === true
          && link.projectPath != null
          && (repoRoot === link.projectPath
            || repoRoot.startsWith(link.projectPath + '/')
            || link.projectPath!.startsWith(repoRoot + '/')),
        );

        if (launchingEntry) {
          const [launchingId] = launchingEntry;
          info('reconciler', `Associating worktree branch=${baseName} with launching card ${launchingId.substring(0, 12)}`);
          let link = { ...linksById[launchingId] };
          if (!link.worktreeLink) {
            link = { ...link, worktreeLink: { path: worktree.path, branch: baseName } };
          }
          linksById[launchingId] = link;
          if (!cardIdsByBranch[baseName]) cardIdsByBranch[baseName] = [];
          cardIdsByBranch[baseName].push(launchingId);
        } else {
          // Orphan worktree -- create a new card
          info('reconciler', `Orphan worktree branch=${baseName} -> new card`);
          const newLink = createLink({
            id: generate(),
            projectPath: repoRoot,
            source: 'discovered',
            worktreeLink: { path: worktree.path, branch: baseName },
          });
          linksById[newLink.id] = newLink;
          if (!cardIdsByBranch[baseName]) cardIdsByBranch[baseName] = [];
          cardIdsByBranch[baseName].push(newLink.id);
        }
      } else {
        // Update existing card's worktree link
        for (const cardId of existingCardIds) {
          const link = linksById[cardId];
          if (!link) continue;
          let updated = { ...link };

          if (updated.worktreeLink) {
            // Already has worktreeLink -- only update path if same branch
            if (updated.worktreeLink.branch === baseName) {
              updated = { ...updated, worktreeLink: { ...updated.worktreeLink, path: worktree.path } };
            }
          } else if (isBranchDiscoveryBlocked(updated.manualOverrides)) {
            // Branch discovery blocked -- don't re-attach worktree
            continue;
          } else {
            // Attach worktree only if repo matches
            const expectedRepo = updated.discoveredRepos?.[baseName] ?? updated.projectPath;
            if (expectedRepo != null && expectedRepo !== repoRoot) continue;
            info('reconciler', `Setting worktreeLink on card ${cardId.substring(0, 12)} for branch=${baseName}`);
            updated = { ...updated, worktreeLink: { path: worktree.path, branch: baseName } };
          }

          linksById[cardId] = updated;
        }
      }
    }
  }

  // B1.5: Refresh worktree branches from snapshot.
  for (const link of Object.values(linksById)) {
    const wtPath = link.worktreeLink?.path;
    const oldBranch = link.worktreeLink?.branch;
    if (!wtPath || !oldBranch) continue;

    for (const worktrees of Object.values(snapshot.worktrees)) {
      const wt = worktrees.find(w => w.path === wtPath);
      if (wt?.branch) {
        const newBranch = wt.branch.replace('refs/heads/', '');
        if (newBranch !== oldBranch) {
          let updated = { ...link };
          updated = {
            ...updated,
            worktreeLink: { ...updated.worktreeLink!, branch: newBranch },
            prLinks: [], // PR was matched via old branch -- clear stale link
          };
          linksById[link.id] = updated;
          // Update branch index
          const oldList = cardIdsByBranch[oldBranch];
          if (oldList) {
            cardIdsByBranch[oldBranch] = oldList.filter(id => id !== link.id);
          }
          if (!cardIdsByBranch[newBranch]) cardIdsByBranch[newBranch] = [];
          cardIdsByBranch[newBranch].push(link.id);
          info('reconciler', `Branch changed on worktree ${wtPath}: ${oldBranch} -> ${newBranch}`);
          break;
        }
      }
    }
  }

  // B2. Absorb orphan worktree cards into real cards on the same branch
  for (const [branch, cardIds] of Object.entries(cardIdsByBranch)) {
    if (cardIds.length <= 1) continue;

    const orphanIds = cardIds.filter(id => {
      const l = linksById[id];
      return l && l.sessionLink == null && l.source !== 'manual' && l.name == null;
    });
    if (orphanIds.length === 0) continue;

    const realIds = cardIds.filter(id => !orphanIds.includes(id));
    const keeperId = realIds[0] ?? orphanIds[0];
    let keeper = { ...linksById[keeperId] };

    for (const orphanId of orphanIds) {
      if (orphanId === keeperId) continue;
      const orphan = linksById[orphanId];
      if (orphan) {
        if (!keeper.worktreeLink) keeper = { ...keeper, worktreeLink: orphan.worktreeLink };
        if (!keeper.tmuxLink) keeper = { ...keeper, tmuxLink: orphan.tmuxLink };
        info('reconciler', `Dedup: absorbing orphan ${orphanId.substring(0, 12)} (branch=${branch}) into ${keeperId.substring(0, 12)}`);
      }
      delete linksById[orphanId];
    }
    linksById[keeperId] = keeper;
    cardIdsByBranch[branch] = cardIds.filter(id => !orphanIds.includes(id) || id === keeperId);
  }

  // C. Match PRs to existing cards via branch (add or update)
  for (const [branch, pr] of Object.entries(snapshot.pullRequests)) {
    const cardIds = cardIdsByBranch[branch] ?? [];
    if (cardIds.length === 0) {
      info('reconciler', `PR #${pr.number} on branch=${branch} has no matching card`);
    }
    for (const cardId of cardIds) {
      const link = linksById[cardId];
      if (!link) continue;

      // User dismissed this PR -- don't re-add
      if (isPRDismissed(link.manualOverrides, pr.number)) continue;

      let updated = { ...link };
      const prLinks = [...updated.prLinks];
      const idx = prLinks.findIndex(p => p.number === pr.number);
      if (idx >= 0) {
        info('reconciler', `Updating PR #${pr.number} on card ${cardId.substring(0, 12)}: status=${pr.state}`);
        prLinks[idx] = {
          ...prLinks[idx],
          status: (pr as any).status ?? prLinks[idx].status,
          url: pr.url,
          title: pr.title,
          mergeStateStatus: pr.mergeStateStatus,
        };
      } else {
        info('reconciler', `Adding PR #${pr.number} to card ${cardId.substring(0, 12)}: status=${pr.state}`);
        prLinks.push({
          number: pr.number,
          url: pr.url,
          status: (pr as any).status ?? null,
          title: pr.title,
          mergeStateStatus: pr.mergeStateStatus,
        });
      }
      updated = { ...updated, prLinks };
      linksById[cardId] = updated;
    }
  }

  // D. Clear dead links
  for (const [id, link] of Object.entries(linksById)) {
    let updated = { ...link };
    let changed = false;

    // Clear dead tmux links
    if (updated.tmuxLink && updated.isLaunching !== true && !updated.manualOverrides.tmuxSession && didScanTmux) {
      let tmux = { ...updated.tmuxLink };
      const primaryAlive = liveTmuxNames.has(tmux.sessionName);

      // Filter dead extra sessions
      if (tmux.extraSessions) {
        const liveExtras = tmux.extraSessions.filter(s => liveTmuxNames.has(s));
        tmux = { ...tmux, extraSessions: liveExtras.length === 0 ? null : liveExtras };
      }

      if (!primaryAlive && !tmux.extraSessions) {
        // Both primary and all extras dead
        updated = { ...updated, tmuxLink: null };
        changed = true;
      } else if (!primaryAlive) {
        // Primary dead but extras alive
        tmux = { ...tmux, isPrimaryDead: true };
        updated = { ...updated, tmuxLink: tmux };
        changed = true;
      } else {
        // Primary alive -- ensure isPrimaryDead is cleared
        if (tmux.isPrimaryDead != null) {
          tmux = { ...tmux, isPrimaryDead: null };
        }
        // Check if tmux changed
        if (JSON.stringify(tmux) !== JSON.stringify(updated.tmuxLink)) {
          updated = { ...updated, tmuxLink: tmux };
          changed = true;
        }
      }
    }

    // Clear dead worktree links
    if (
      updated.worktreeLink?.path
      && updated.worktreeLink.path.length > 0
      && !isBranchDiscoveryBlocked(updated.manualOverrides)
      && didScanWorktrees
      && !liveWorktreePaths.has(updated.worktreeLink.path)
    ) {
      updated = { ...updated, worktreeLink: null };
      changed = true;
    }

    if (changed) {
      linksById[id] = updated;
    }
  }

  return Object.values(linksById);
}

// MARK: - Private Helpers

/**
 * Check if sessionPath is a worktree directory under a project root.
 */
function isWorktreeUnder(sessionPath: string, projectRoot: string | null | undefined): boolean {
  if (!projectRoot) return false;
  return sessionPath.startsWith(projectRoot + '/.claude/worktrees/');
}

/**
 * Find an existing card that should own this session.
 * Match priority: exact sessionId -> worktree branch -> projectPath+tmux.
 */
function findCardForSession(
  session: Session,
  cardIdBySessionId: Record<string, string>,
  cardIdByTmuxName: Record<string, string>,
  cardIdsByBranch: Record<string, string[]>,
  linksById: Record<string, Link>,
): string | null {
  // 1. Exact match by sessionId
  if (cardIdBySessionId[session.id]) {
    return cardIdBySessionId[session.id];
  }

  // 2. Match by worktree branch
  if (session.gitBranch) {
    const baseName = session.gitBranch.replace('refs/heads/', '');
    const cardIds = cardIdsByBranch[baseName];
    if (cardIds) {
      const sameProject = cardIds.filter(cardId => {
        const link = linksById[cardId];
        if (!link) return false;
        if (!session.projectPath) return true;
        return link.projectPath === session.projectPath
          || isWorktreeUnder(session.projectPath, link.projectPath);
      });
      // Prefer cards that don't already have a session (pending cards)
      const pendingCards = sameProject.filter(id => !linksById[id]?.sessionLink);
      if (pendingCards.length > 0) return pendingCards[0];
      if (sameProject.length > 0) return sameProject[0];
    }
  }

  // 3. Match by project path + tmux
  if (session.projectPath) {
    for (const link of Object.values(linksById)) {
      if (
        link.tmuxLink
        && !link.sessionLink
        && (link.projectPath === session.projectPath
          || isWorktreeUnder(session.projectPath, link.projectPath))
      ) {
        return link.id;
      }
    }
  }

  return null;
}
