import type { PullRequest, CheckRun, CheckRunStatus, CheckRunConclusion, ChecksStatus } from '@kanban-code/shared';
import type { PRTrackerPort } from '../../domain/ports/pr-tracker.js';
import { run, findExecutable } from '../../infrastructure/shell-command.js';
import { info, warn } from '../../infrastructure/logger.js';

/**
 * GitHub integration via the `gh` CLI tool.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Git/GhCliAdapter.swift
 * Spec: Section 7.4 (Pull Request Tab)
 *
 * Implements PRTrackerPort. Key features:
 * - fetchPRs: `gh pr list` with JSON output
 * - enrichPRDetails: GraphQL batch with field aliases (pr0/pr1/pr2)
 * - batchPRLookup: single GraphQL call per repo
 * - fetchPRBody, fetchIssues, mergePR
 * - isAvailable: `gh auth status`
 * - Rate limit detection
 */

export class GhCliAdapter implements PRTrackerPort {
  private readonly ghPath: string;

  constructor() {
    this.ghPath = findExecutable('gh') ?? 'gh';
  }

  async fetchPRs(repoRoot: string): Promise<Record<string, PullRequest>> {
    info('gh', `fetchPRs for ${repoRoot}`);
    const result = await run(this.ghPath, [
      'pr', 'list', '--state', 'all', '--limit', '50',
      '--json', 'number,title,state,url,headRefName,reviewDecision',
    ], { cwd: repoRoot });

    if (!result.succeeded || !result.stdout) {
      warn('gh', `fetchPRs failed or empty for ${repoRoot}: exit=${result.exitCode} stderr=${result.stderr.substring(0, 200)}`);
      return {};
    }

    let items: Record<string, unknown>[];
    try {
      items = JSON.parse(result.stdout);
    } catch {
      return {};
    }
    if (!Array.isArray(items)) return {};

    const prs: Record<string, PullRequest> = {};
    for (const item of items) {
      const number = item.number as number | undefined;
      const title = item.title as string | undefined;
      const state = item.state as string | undefined;
      const url = item.url as string | undefined;
      const headRefName = item.headRefName as string | undefined;
      if (number == null || !title || !state || !url || !headRefName) continue;

      const reviewDecision = (item.reviewDecision as string) ?? null;
      const pr: PullRequest = {
        number,
        title,
        state: state.toLowerCase() === 'merged' ? 'merged' : state.toLowerCase(),
        url,
        headRefName,
        reviewDecision,
        checksStatus: 'none',
        unresolvedThreads: 0,
        approvalCount: 0,
        checkRuns: [],
      };

      // Prefer open PRs over closed/merged for the same branch
      const existing = prs[headRefName];
      if (existing) {
        if (pr.state === 'open' && existing.state !== 'open') {
          prs[headRefName] = pr;
        }
      } else {
        prs[headRefName] = pr;
      }
    }

    return prs;
  }

  async enrichPRDetails(repoRoot: string, prs: Record<string, PullRequest>): Promise<Record<string, PullRequest>> {
    const openPRs = Object.values(prs).filter(pr => pr.state === 'open');
    if (openPRs.length === 0) return prs;

    // Build GraphQL query with aliases for each PR
    const queryParts: string[] = [];
    const aliasMap: Record<string, string> = {}; // alias -> branch

    openPRs.forEach((pr, i) => {
      const alias = `pr${i}`;
      aliasMap[alias] = pr.headRefName;
      queryParts.push(`
        ${alias}: pullRequest(number: ${pr.number}) {
          body
          reviewDecision
          mergeStateStatus
          reviewThreads(first: 100) { nodes { isResolved comments(first: 1) { nodes { url } } } }
          reviews(states: APPROVED) { totalCount }
          commits(last: 1) { nodes { commit { statusCheckRollup {
            state
            contexts(first: 50) { nodes {
              ... on CheckRun { name status conclusion }
              ... on StatusContext { context state }
            } }
          } } } }
        }
      `);
    });

    // Get repo owner/name
    const repoInfo = await this.getRepoInfo(repoRoot);
    if (!repoInfo) return prs;

    const query = `query {
  repository(owner: "${repoInfo.owner}", name: "${repoInfo.name}") {
    ${queryParts.join('\n')}
  }
}`;

    const graphqlResult = await run(this.ghPath, [
      'api', 'graphql', '-f', `query=${query}`,
    ], { cwd: repoRoot });

    if (!graphqlResult.succeeded) return prs;

    let repo: Record<string, unknown>;
    try {
      const parsed = JSON.parse(graphqlResult.stdout) as Record<string, unknown>;
      const data = parsed.data as Record<string, unknown> | undefined;
      repo = data?.repository as Record<string, unknown>;
    } catch {
      return prs;
    }
    if (!repo) return prs;

    const result = { ...prs };
    for (const [alias, branch] of Object.entries(aliasMap)) {
      const pr = result[branch];
      const prData = repo[alias] as Record<string, unknown> | undefined;
      if (!pr || !prData) continue;

      const updated = { ...pr };

      // PR body
      if (typeof prData.body === 'string' && prData.body.length > 0) {
        updated.body = prData.body;
      }

      // Review decision
      if (typeof prData.reviewDecision === 'string') {
        updated.reviewDecision = prData.reviewDecision;
      }

      // Merge state status
      if (typeof prData.mergeStateStatus === 'string') {
        updated.mergeStateStatus = prData.mergeStateStatus;
      }

      // Approval count
      const reviews = prData.reviews as Record<string, unknown> | undefined;
      if (reviews && typeof reviews.totalCount === 'number') {
        updated.approvalCount = reviews.totalCount;
      }

      // Unresolved threads
      const threads = prData.reviewThreads as Record<string, unknown> | undefined;
      if (threads) {
        const nodes = threads.nodes as Record<string, unknown>[];
        if (Array.isArray(nodes)) {
          const unresolved = nodes.filter(n => n.isResolved === false);
          updated.unresolvedThreads = unresolved.length;
          if (unresolved.length > 0) {
            const firstThread = unresolved[0];
            const comments = firstThread.comments as Record<string, unknown> | undefined;
            const commentNodes = comments?.nodes as Record<string, unknown>[];
            if (Array.isArray(commentNodes) && commentNodes.length > 0) {
              const urlVal = commentNodes[0].url;
              if (typeof urlVal === 'string') {
                updated.firstUnresolvedThreadURL = urlVal;
              }
            }
          }
        }
      }

      // CI status + individual check runs
      const commits = prData.commits as Record<string, unknown> | undefined;
      if (commits) {
        const commitNodes = commits.nodes as Record<string, unknown>[];
        if (Array.isArray(commitNodes) && commitNodes.length > 0) {
          const lastCommit = commitNodes[commitNodes.length - 1];
          const commit = lastCommit.commit as Record<string, unknown> | undefined;
          const rollup = commit?.statusCheckRollup as Record<string, unknown> | undefined;
          if (rollup) {
            // Aggregate state
            if (typeof rollup.state === 'string') {
              switch (rollup.state.toUpperCase()) {
                case 'SUCCESS': updated.checksStatus = 'pass'; break;
                case 'FAILURE': case 'ERROR': updated.checksStatus = 'fail'; break;
                case 'PENDING': updated.checksStatus = 'pending'; break;
              }
            }

            // Individual check runs
            const contexts = rollup.contexts as Record<string, unknown> | undefined;
            if (contexts) {
              const contextNodes = contexts.nodes as Record<string, unknown>[];
              if (Array.isArray(contextNodes)) {
                const runs: CheckRun[] = [];
                for (const node of contextNodes) {
                  if (typeof node.name === 'string') {
                    // CheckRun type
                    const status = parseCheckRunStatus(node.status as string | undefined);
                    const conclusion = parseCheckRunConclusion(node.conclusion as string | undefined);
                    runs.push({ name: node.name, status, conclusion });
                  } else if (typeof node.context === 'string' && typeof node.state === 'string') {
                    // StatusContext type
                    let conclusion: CheckRunConclusion | null = null;
                    switch (node.state.toUpperCase()) {
                      case 'SUCCESS': conclusion = 'success'; break;
                      case 'FAILURE': case 'ERROR': conclusion = 'failure'; break;
                    }
                    runs.push({ name: node.context, status: 'completed', conclusion });
                  }
                }
                updated.checkRuns = runs;
              }
            }
          }
        }
      }

      result[branch] = updated;
    }

    return result;
  }

  /**
   * Batch lookup: find PRs by branch name + refresh existing PRs by number.
   * Single GraphQL call per repo instead of N individual `gh pr` calls.
   */
  async batchPRLookup(
    repoRoot: string,
    branches: string[],
    prNumbers: number[],
  ): Promise<{ byBranch: Record<string, PullRequest>; byNumber: Record<number, PullRequest> }> {
    if (branches.length === 0 && prNumbers.length === 0) return { byBranch: {}, byNumber: {} };

    const repoInfo = await this.getRepoInfo(repoRoot);
    if (!repoInfo) return { byBranch: {}, byNumber: {} };

    const queryParts: string[] = [];
    const branchAliases: Record<string, string> = {};
    const numberAliases: Record<string, number> = {};

    // Branch lookups
    branches.forEach((branch, i) => {
      const alias = `branch${i}`;
      branchAliases[alias] = branch;
      queryParts.push(
        `${alias}: pullRequests(headRefName: "${branch}", first: 1, states: [OPEN, CLOSED, MERGED], orderBy: {field: CREATED_AT, direction: DESC}) { nodes { number title state url headRefName reviewDecision mergeStateStatus reviews(states: APPROVED) { totalCount } } }`,
      );
    });

    // PR number lookups
    prNumbers.forEach((num, i) => {
      const alias = `pr${i}`;
      numberAliases[alias] = num;
      queryParts.push(
        `${alias}: pullRequest(number: ${num}) { number title state url headRefName reviewDecision mergeStateStatus reviews(states: APPROVED) { totalCount } }`,
      );
    });

    const query = `query { repository(owner: "${repoInfo.owner}", name: "${repoInfo.name}") { ${queryParts.join('\n')} } }`;

    const result = await run(this.ghPath, [
      'api', 'graphql', '-f', `query=${query}`,
    ], { cwd: repoRoot });

    // Rate limit detection
    const combined = result.stderr + result.stdout;
    if (combined.toLowerCase().includes('rate limit') || combined.includes('RATE_LIMITED')) {
      warn('gh', 'batchPRLookup hit rate limit');
      throw new GhCliError('rateLimited');
    }

    // Try to parse response
    let repo: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      const data = parsed.data as Record<string, unknown> | undefined;
      repo = data?.repository as Record<string, unknown>;
    } catch {
      /* fall through */
    }

    // If batch failed entirely, retry individually
    if (!repo && Object.keys(numberAliases).length > 0) {
      warn('gh', `batchPRLookup GraphQL failed, retrying PRs individually: ${result.stderr.substring(0, 200)}`);
      return this.retryIndividually(repoRoot, repoInfo, branchAliases, numberAliases);
    }

    if (!repo) {
      warn('gh', `batchPRLookup GraphQL failed: ${result.stderr.substring(0, 200)}`);
      return { byBranch: {}, byNumber: {} };
    }

    const byBranch: Record<string, PullRequest> = {};
    const byNumber: Record<number, PullRequest> = {};

    for (const [alias, branch] of Object.entries(branchAliases)) {
      const container = repo[alias] as Record<string, unknown> | undefined;
      const nodes = container?.nodes as Record<string, unknown>[];
      if (!Array.isArray(nodes) || nodes.length === 0) continue;
      const pr = this.parsePRFromGraphQL(nodes[0]);
      if (pr) byBranch[branch] = pr;
    }

    for (const [alias, number] of Object.entries(numberAliases)) {
      const item = repo[alias] as Record<string, unknown> | undefined;
      if (!item) continue;
      const pr = this.parsePRFromGraphQL(item);
      if (pr) byNumber[number] = pr;
    }

    return { byBranch, byNumber };
  }

  async fetchPRBody(repoRoot: string, prNumber: number): Promise<string | null> {
    const result = await run(this.ghPath, [
      'pr', 'view', `${prNumber}`, '--json', 'body',
    ], { cwd: repoRoot });

    if (!result.succeeded || !result.stdout) return null;

    try {
      const json = JSON.parse(result.stdout) as Record<string, unknown>;
      return typeof json.body === 'string' ? json.body : null;
    } catch {
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!findExecutable('gh')) return false;

    try {
      const result = await run(this.ghPath, ['auth', 'status']);
      return result.succeeded;
    } catch {
      return false;
    }
  }

  /** Fetch GitHub issues matching a filter query. */
  async fetchIssues(repoRoot: string, filter: string): Promise<GitHubIssue[]> {
    const filterArgs = filter.split(' ').filter(Boolean);
    const result = await run(this.ghPath, [
      'search', 'issues', '--match', 'title,body',
      '--json', 'number,title,body,url,labels',
      '--limit', '25',
      ...filterArgs,
    ], { cwd: repoRoot });

    if (!result.succeeded || !result.stdout) return [];

    let items: Record<string, unknown>[];
    try {
      items = JSON.parse(result.stdout);
    } catch {
      return [];
    }
    if (!Array.isArray(items)) return [];

    return items
      .map(item => {
        const number = item.number as number | undefined;
        const title = item.title as string | undefined;
        const url = item.url as string | undefined;
        if (number == null || !title || !url) return null;
        const body = (item.body as string) ?? null;
        const labels = Array.isArray(item.labels)
          ? (item.labels as Record<string, unknown>[]).map(l => l.name as string).filter(Boolean)
          : [];
        return { number, title, body: body as string | null, url, labels };
      })
      .filter((i): i is GitHubIssue => i !== null);
  }

  /**
   * Merge a PR using the configured merge command template.
   * The template can contain `${number}` which gets replaced with the PR number.
   */
  async mergePR(repoRoot: string, prNumber: number, commandTemplate: string): Promise<MergeResult> {
    const expanded = commandTemplate.replace('${number}', `${prNumber}`);
    const parts = expanded.split(' ').filter(Boolean);
    if (parts.length < 2) return { type: 'failure', message: 'Invalid merge command' };

    const executable = findExecutable(parts[0]) ?? parts[0];
    const args = parts.slice(1);

    const result = await run(executable, args, { cwd: repoRoot });
    info('merge', `gh merge exit=${result.exitCode} stdout=[${result.stdout.substring(0, 200)}] stderr=[${result.stderr.substring(0, 200)}]`);

    const output = (result.stdout + ' ' + result.stderr).toLowerCase();
    const mergeSucceeded = result.succeeded
      || output.includes('merged')
      || (output.includes('pull request') && output.includes('merge'))
      || (output.includes('delete') && output.includes('branch'));

    if (mergeSucceeded) {
      const warning = result.succeeded ? null : result.stderr.trim() || null;
      return { type: 'success', warning };
    } else {
      return { type: 'failure', message: result.stderr.trim() };
    }
  }

  // MARK: - Private

  private async getRepoInfo(repoRoot: string): Promise<{ owner: string; name: string } | null> {
    const repoResult = await run(this.ghPath, [
      'repo', 'view', '--json', 'owner,name',
    ], { cwd: repoRoot });

    if (!repoResult.succeeded) return null;

    try {
      const repoData = JSON.parse(repoResult.stdout) as Record<string, unknown>;
      const owner = repoData.owner as Record<string, unknown> | undefined;
      const ownerLogin = owner?.login as string;
      const repoName = repoData.name as string;
      if (!ownerLogin || !repoName) return null;
      return { owner: ownerLogin, name: repoName };
    } catch {
      return null;
    }
  }

  private parsePRFromGraphQL(item: Record<string, unknown>): PullRequest | null {
    const number = item.number as number | undefined;
    const title = item.title as string | undefined;
    const state = item.state as string | undefined;
    const url = item.url as string | undefined;
    const headRefName = item.headRefName as string | undefined;
    if (number == null || !title || !state || !url || !headRefName) return null;

    const reviewDecision = (item.reviewDecision as string) ?? null;
    const reviews = item.reviews as Record<string, unknown> | undefined;
    const approvalCount = (reviews?.totalCount as number) ?? 0;
    const mergeStateStatus = (item.mergeStateStatus as string) ?? null;

    return {
      number,
      title,
      state: state.toLowerCase() === 'merged' ? 'merged' : state.toLowerCase(),
      url,
      headRefName,
      reviewDecision,
      checksStatus: 'none',
      unresolvedThreads: 0,
      approvalCount,
      checkRuns: [],
      mergeStateStatus,
    };
  }

  private async retryIndividually(
    repoRoot: string,
    repoInfo: { owner: string; name: string },
    branchAliases: Record<string, string>,
    numberAliases: Record<string, number>,
  ): Promise<{ byBranch: Record<string, PullRequest>; byNumber: Record<number, PullRequest> }> {
    const byBranch: Record<string, PullRequest> = {};
    const byNumber: Record<number, PullRequest> = {};

    // Retry branches as a single batch
    if (Object.keys(branchAliases).length > 0) {
      const parts = Object.entries(branchAliases).map(([alias, branch]) =>
        `${alias}: pullRequests(headRefName: "${branch}", first: 1, states: [OPEN, CLOSED, MERGED], orderBy: {field: CREATED_AT, direction: DESC}) { nodes { number title state url headRefName reviewDecision mergeStateStatus reviews(states: APPROVED) { totalCount } } }`,
      );
      const branchQuery = `query { repository(owner: "${repoInfo.owner}", name: "${repoInfo.name}") { ${parts.join('\n')} } }`;
      try {
        const brResult = await run(this.ghPath, ['api', 'graphql', '-f', `query=${branchQuery}`], { cwd: repoRoot });
        if (brResult.succeeded) {
          const parsed = JSON.parse(brResult.stdout) as Record<string, unknown>;
          const data = parsed.data as Record<string, unknown> | undefined;
          const repo = data?.repository as Record<string, unknown>;
          if (repo) {
            for (const [alias, branch] of Object.entries(branchAliases)) {
              const container = repo[alias] as Record<string, unknown> | undefined;
              const nodes = container?.nodes as Record<string, unknown>[];
              if (!Array.isArray(nodes) || nodes.length === 0) continue;
              const pr = this.parsePRFromGraphQL(nodes[0]);
              if (pr) byBranch[branch] = pr;
            }
          }
        }
      } catch { /* continue */ }
    }

    // Retry each PR number individually
    for (const [, number] of Object.entries(numberAliases)) {
      const singleQuery = `query { repository(owner: "${repoInfo.owner}", name: "${repoInfo.name}") { pullRequest(number: ${number}) { number title state url headRefName reviewDecision mergeStateStatus reviews(states: APPROVED) { totalCount } } } }`;
      try {
        const sResult = await run(this.ghPath, ['api', 'graphql', '-f', `query=${singleQuery}`], { cwd: repoRoot });
        if (sResult.succeeded) {
          const parsed = JSON.parse(sResult.stdout) as Record<string, unknown>;
          const data = parsed.data as Record<string, unknown> | undefined;
          const repo = data?.repository as Record<string, unknown>;
          if (repo) {
            const item = repo.pullRequest as Record<string, unknown>;
            if (item) {
              const pr = this.parsePRFromGraphQL(item);
              if (pr) byNumber[number] = pr;
            }
          }
        }
      } catch {
        info('gh', `batchPRLookup: PR #${number} not found, skipping`);
      }
    }

    return { byBranch, byNumber };
  }
}

// MARK: - Helper parsers

function parseCheckRunStatus(raw: string | undefined): CheckRunStatus {
  if (!raw) return 'completed';
  const lower = raw.toLowerCase().replace(/_/g, '_');
  if (lower === 'queued' || lower === 'in_progress' || lower === 'completed') {
    return lower as CheckRunStatus;
  }
  return 'completed';
}

function parseCheckRunConclusion(raw: string | undefined): CheckRunConclusion | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const valid: CheckRunConclusion[] = ['success', 'failure', 'neutral', 'cancelled', 'timed_out', 'action_required', 'skipped'];
  return valid.includes(lower as CheckRunConclusion) ? (lower as CheckRunConclusion) : null;
}

// MARK: - Types

export type MergeResult =
  | { type: 'success'; warning: string | null }
  | { type: 'failure'; message: string };

export class GhCliError extends Error {
  constructor(public readonly code: 'rateLimited') {
    super(
      code === 'rateLimited'
        ? 'GitHub API rate limit exceeded -- pausing PR lookups for 5 minutes'
        : `GH CLI error: ${code}`,
    );
    this.name = 'GhCliError';
  }
}

/** A GitHub issue for the backlog. */
export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  url: string;
  labels: string[];
}
