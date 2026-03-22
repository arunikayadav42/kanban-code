import fs from 'fs';
import path from 'path';
import os from 'os';
import type { KanbanCodeColumn, CodingAssistant, Project } from '@kanban-code/shared';
import { ALL_COLUMNS, ALL_ASSISTANTS } from '@kanban-code/shared';
import { stringifySorted } from './json-utils.js';

/**
 * Application settings, stored at ~/.kanban-code/settings.json.
 *
 * Swift source: Sources/KanbanCodeCore/Infrastructure/SettingsStore.swift
 * Spec: Section 7.7 (Settings Schema & Defaults)
 */

// MARK: - Settings sub-structs

export interface GlobalViewSettings {
  excludedPaths: string[];
}

export interface GitHubSettings {
  defaultFilter: string;
  pollIntervalSeconds: number;
  mergeCommand: string;
}

export const DEFAULT_MERGE_COMMAND = 'gh pr merge ${number} --squash --delete-branch';

export interface NotificationSettings {
  pushoverEnabled: boolean;
  pushoverToken?: string | null;
  pushoverUserKey?: string | null;
  renderMarkdownImage: boolean;
}

export interface RemoteSettings {
  host: string;
  remotePath: string;
  localPath: string;
  syncIgnores?: string[] | null;
}

export interface SessionTimeoutSettings {
  activeThresholdMinutes: number;
}

// MARK: - Settings

export interface Settings {
  projects: Project[];
  globalView: GlobalViewSettings;
  github: GitHubSettings;
  notifications: NotificationSettings;
  remote: RemoteSettings | null;
  sessionTimeout: SessionTimeoutSettings;
  promptTemplate: string;
  githubIssuePromptTemplate: string;
  columnOrder: KanbanCodeColumn[];
  hasCompletedOnboarding: boolean;
  defaultAssistant: CodingAssistant | null;
  enabledAssistants: CodingAssistant[];
}

export function createDefaultSettings(): Settings {
  return {
    projects: [],
    globalView: { excludedPaths: [] },
    github: { defaultFilter: 'assignee:@me is:open', pollIntervalSeconds: 60, mergeCommand: DEFAULT_MERGE_COMMAND },
    notifications: { pushoverEnabled: false, renderMarkdownImage: false },
    remote: null,
    sessionTimeout: { activeThresholdMinutes: 1440 },
    promptTemplate: '',
    githubIssuePromptTemplate: '#${number}: ${title}\n\n${body}',
    columnOrder: [...ALL_COLUMNS],
    hasCompletedOnboarding: false,
    defaultAssistant: null,
    enabledAssistants: [...ALL_ASSISTANTS],
  };
}

/**
 * Parse settings from JSON with backward-compat defaults.
 * Mirrors Swift Settings.init(from decoder:) exactly.
 */
export function parseSettings(json: Record<string, unknown>): Settings {
  const defaults = createDefaultSettings();
  const github = json.github as Record<string, unknown> | undefined;
  const notifications = json.notifications as Record<string, unknown> | undefined;

  return {
    projects: (json.projects as Project[]) ?? defaults.projects,
    globalView: (json.globalView as GlobalViewSettings) ?? defaults.globalView,
    github: {
      defaultFilter: (github?.defaultFilter as string) ?? defaults.github.defaultFilter,
      pollIntervalSeconds: (github?.pollIntervalSeconds as number) ?? defaults.github.pollIntervalSeconds,
      mergeCommand: (github?.mergeCommand as string) ?? defaults.github.mergeCommand,
    },
    notifications: {
      pushoverEnabled: (notifications?.pushoverEnabled as boolean) ?? false,
      pushoverToken: (notifications?.pushoverToken as string) ?? null,
      pushoverUserKey: (notifications?.pushoverUserKey as string) ?? null,
      renderMarkdownImage: (notifications?.renderMarkdownImage as boolean) ?? false,
    },
    remote: (json.remote as RemoteSettings) ?? null,
    sessionTimeout: {
      activeThresholdMinutes: ((json.sessionTimeout as Record<string, unknown>)?.activeThresholdMinutes as number) ?? 1440,
    },
    // Backward-compat: "skill" key falls back to promptTemplate
    promptTemplate: (json.promptTemplate as string) ?? (json.skill as string) ?? defaults.promptTemplate,
    githubIssuePromptTemplate: (json.githubIssuePromptTemplate as string) ?? defaults.githubIssuePromptTemplate,
    columnOrder: (json.columnOrder as KanbanCodeColumn[]) ?? defaults.columnOrder,
    hasCompletedOnboarding: (json.hasCompletedOnboarding as boolean) ?? false,
    defaultAssistant: (json.defaultAssistant as CodingAssistant) ?? null,
    enabledAssistants: (json.enabledAssistants as CodingAssistant[]) ?? [...ALL_ASSISTANTS],
  };
}

// MARK: - SettingsStore

export class SettingsStore {
  private readonly filePath: string;
  private cachedSettings: Settings | null = null;
  private cachedMtimeMs: number | null = null;

  constructor(basePath?: string) {
    const base = basePath ?? path.join(os.homedir(), '.kanban-code');
    this.filePath = path.join(base, 'settings.json');
  }

  /** Invalidate cache so next read() re-reads from disk. */
  invalidateCache(): void {
    this.cachedSettings = null;
    this.cachedMtimeMs = null;
  }

  /** Read settings, creating defaults if file doesn't exist. Mtime-cached. */
  read(): Settings {
    if (!fs.existsSync(this.filePath)) {
      const defaults = createDefaultSettings();
      this.write(defaults);
      return defaults;
    }

    // Check mtime — return cached if unchanged
    try {
      const stat = fs.statSync(this.filePath);
      if (this.cachedSettings && this.cachedMtimeMs === stat.mtimeMs) {
        return this.cachedSettings;
      }

      const data = fs.readFileSync(this.filePath, 'utf-8');
      const json = JSON.parse(data);
      const settings = parseSettings(json);
      this.cachedSettings = settings;
      this.cachedMtimeMs = stat.mtimeMs;
      return settings;
    } catch {
      return createDefaultSettings();
    }
  }

  /** Write settings atomically (.tmp → rename). Updates cache. */
  write(settings: Settings): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    // Note: "skill" key is NOT written — only read for backward-compat
    const data = stringifySorted(settings);
    const tmpPath = this.filePath + '.tmp';
    fs.writeFileSync(tmpPath, data, 'utf-8');
    try { fs.unlinkSync(this.filePath); } catch { /* may not exist */ }
    fs.renameSync(tmpPath, this.filePath);

    // Update cache
    this.cachedSettings = settings;
    try {
      this.cachedMtimeMs = fs.statSync(this.filePath).mtimeMs;
    } catch { /* ignore */ }
  }

  /** The file path for external access. */
  get path(): string { return this.filePath; }

  // MARK: - Project convenience methods

  addProject(project: Project): void {
    const settings = this.read();
    if (settings.projects.some(p => p.path === project.path)) {
      throw new SettingsError('duplicateProject', project.path);
    }
    settings.projects.push(project);
    this.write(settings);
  }

  updateProject(project: Project): void {
    const settings = this.read();
    const index = settings.projects.findIndex(p => p.path === project.path);
    if (index < 0) throw new SettingsError('projectNotFound', project.path);
    settings.projects[index] = project;
    this.write(settings);
  }

  removeProject(projectPath: string): void {
    const settings = this.read();
    if (!settings.projects.some(p => p.path === projectPath)) {
      throw new SettingsError('projectNotFound', projectPath);
    }
    settings.projects = settings.projects.filter(p => p.path !== projectPath);
    this.write(settings);
  }

  reorderProjects(projects: Project[]): void {
    const settings = this.read();
    settings.projects = projects;
    this.write(settings);
  }
}

export class SettingsError extends Error {
  constructor(public readonly code: 'duplicateProject' | 'projectNotFound', public readonly projectPath: string) {
    super(code === 'duplicateProject'
      ? `Project already configured: ${projectPath}`
      : `Project not found: ${projectPath}`);
    this.name = 'SettingsError';
  }
}
