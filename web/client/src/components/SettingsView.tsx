/**
 * SettingsView -- tabbed settings panel.
 *
 * Sections: Projects, Assistants, General, Notifications, Remote.
 * Uses REST API for read/write: GET /api/settings, PATCH /api/settings.
 * Uses GET /api/health for dependency status.
 *
 * Swift source: Sources/KanbanCode/SettingsView.swift
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Project, CodingAssistant, HealthResponse } from '@kanban-code/shared';
import { ALL_ASSISTANTS, getDisplayName, getInstallCommand } from '@kanban-code/shared';
import { api } from '../lib/api-client.js';
import { useBoardStore } from '../store/index.js';

// MARK: - Types

export interface Settings {
  projects: Project[];
  hiddenProjectPaths?: string[];
  enabledAssistants: CodingAssistant[];
  notifications: {
    pushoverEnabled: boolean;
    pushoverToken?: string | null;
    pushoverUserKey?: string | null;
    renderMarkdownImage: boolean;
  };
  remote?: {
    host: string;
    remotePath: string;
    localPath: string;
    syncIgnores?: string[];
  } | null;
  github: {
    defaultFilter: string;
    pollInterval: number;
    mergeCommand: string;
  };
  globalView: {
    excludedPaths: string[];
  };
  appearance: {
    uiTextSize: number;
    sessionDetailFontSize: number;
  };
  hasCompletedOnboarding?: boolean;
}

type SettingsTab = 'projects' | 'assistants' | 'general' | 'notifications' | 'remote';

interface AssistantStatus {
  available: boolean;
  hooksInstalled: boolean;
  enabled: boolean;
}

// MARK: - Props

export interface SettingsViewProps {
  onClose?: () => void;
}

// MARK: - Default settings

const DEFAULT_SETTINGS: Settings = {
  projects: [],
  enabledAssistants: [...ALL_ASSISTANTS],
  notifications: {
    pushoverEnabled: false,
    pushoverToken: null,
    pushoverUserKey: null,
    renderMarkdownImage: false,
  },
  remote: null,
  github: {
    defaultFilter: '',
    pollInterval: 60,
    mergeCommand: 'gh pr merge ${number} --squash --delete-branch',
  },
  globalView: {
    excludedPaths: [],
  },
  appearance: {
    uiTextSize: 1,
    sessionDetailFontSize: 12,
  },
};

// MARK: - Component

export default function SettingsView({ onClose }: SettingsViewProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<SettingsTab>('projects');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [health, setHealth] = useState<HealthResponse['dependencies'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const backendUrl = useBoardStore(s => s.backendUrl);
  const setBackendUrl = useBoardStore(s => s.setBackendUrl);

  // Load settings and health on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [settingsData, healthData, projectsData] = await Promise.all([
          api.getSettings(),
          api.getHealth(),
          api.getProjects(),
        ]);
        if (!cancelled) {
          setSettings({ ...DEFAULT_SETTINGS, ...(settingsData as unknown as Settings), projects: projectsData.projects ?? [] });
          setHealth(healthData.dependencies);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setIsLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Save settings (debounced via callers)
  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    try {
      const updated = await api.patchSettings(patch);
      setSettings(prev => ({ ...prev, ...(updated as unknown as Settings) }));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'projects', label: 'Projects' },
    { id: 'assistants', label: 'Assistants' },
    { id: 'general', label: 'General' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'remote', label: 'Remote' },
  ];

  return (
    <div
      data-testid="settings-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        minWidth: 520,
        backgroundColor: 'var(--bg-secondary, #1c1c1e)',
        color: 'var(--text-primary, #f5f5f7)',
      }}
    >
      {/* Tab Bar */}
      <div
        data-testid="settings-tab-bar"
        style={{
          display: 'flex',
          gap: 0,
          padding: '0 16px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            data-testid={`settings-tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id
                ? 'var(--text-primary, #f5f5f7)'
                : 'var(--color-secondary, #8e8e93)',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id
                ? '2px solid var(--color-accent, #007AFF)'
                : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20, minHeight: 0 }}>
        {isLoading ? (
          <div data-testid="settings-loading" style={{ textAlign: 'center', padding: 40, color: 'var(--color-secondary, #8e8e93)' }}>
            Loading settings...
          </div>
        ) : (
          <>
            {activeTab === 'projects' && (
              <ProjectsSection settings={settings} onSave={saveSettings} />
            )}
            {activeTab === 'assistants' && (
              <AssistantsSection settings={settings} health={health} onSave={saveSettings} />
            )}
            {activeTab === 'general' && (
              <GeneralSection settings={settings} health={health} onSave={saveSettings} backendUrl={backendUrl} setBackendUrl={setBackendUrl} />
            )}
            {activeTab === 'notifications' && (
              <NotificationsSection settings={settings} health={health} onSave={saveSettings} />
            )}
            {activeTab === 'remote' && (
              <RemoteSection settings={settings} health={health} onSave={saveSettings} />
            )}
          </>
        )}
      </div>

      {/* Error + Close */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center' }}>
        {error && (
          <span data-testid="settings-error" style={{ flex: 1, fontSize: 12, color: '#ef4444' }}>
            {error}
          </span>
        )}
        <span style={{ flex: error ? 0 : 1 }} />
        {onClose && (
          <button
            data-testid="settings-close"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 500,
              backgroundColor: 'var(--color-accent, #007AFF)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}

// MARK: - Projects Section

function ProjectsSection({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (patch: Partial<Settings>) => Promise<void>;
}): React.ReactElement {
  const [newPath, setNewPath] = useState('');

  const addProject = useCallback(() => {
    if (!newPath.trim()) return;
    const name = newPath.split('/').filter(Boolean).pop() ?? newPath;
    const newProject: Project = { path: newPath, name, visible: true };
    if (settings.projects.some(p => p.path === newPath)) return;
    onSave({ projects: [...settings.projects, newProject] });
    setNewPath('');
  }, [newPath, settings.projects, onSave]);

  const hiddenPaths: string[] = settings.hiddenProjectPaths ?? [];

  const removeProject = useCallback((path: string) => {
    api.hideProject(path).catch(() => {});
    onSave({ projects: settings.projects.filter(p => p.path !== path) });
  }, [settings.projects, onSave]);

  const unhideProject = useCallback((path: string) => {
    api.unhideProject(path).then(() => {
      // Re-fetch projects to get the unhidden one back
      api.getProjects().then((res) => {
        onSave({ projects: res.projects });
      }).catch(() => {});
    }).catch(() => {});
  }, [onSave]);

  return (
    <div data-testid="settings-projects">
      <SectionHeader title="Projects" description="Configure which project directories to track." />

      {settings.projects.length === 0 ? (
        <div style={{ color: 'var(--color-secondary, #8e8e93)', fontSize: 13, padding: '12px 0' }}>
          No projects configured
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          {settings.projects.map((project) => (
            <div
              key={project.path}
              data-testid={`project-row-${project.path}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 0',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{project.name}</div>
                <div title={project.path} style={{ fontSize: 11, color: 'var(--color-secondary, #8e8e93)' }}>{project.path}</div>
                {project.githubFilter && (
                  <div style={{ fontSize: 10, color: 'var(--color-tertiary, #aeaeb2)' }}>
                    gh: {project.githubFilter}
                  </div>
                )}
              </div>
              {!project.visible && (
                <span style={{ fontSize: 10, color: 'var(--color-tertiary, #aeaeb2)' }}>Hidden</span>
              )}
              <button
                data-testid={`remove-project-${project.path}`}
                onClick={() => removeProject(project.path)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '4px 8px',
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          data-testid="add-project-input"
          type="text"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          placeholder="/path/to/project"
          onKeyDown={(e) => { if (e.key === 'Enter') addProject(); }}
          style={{
            flex: 1,
            padding: '6px 10px',
            fontSize: 13,
            backgroundColor: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6,
            color: 'var(--text-primary, #f5f5f7)',
          }}
        />
        <button
          data-testid="add-project-button"
          onClick={addProject}
          disabled={!newPath.trim()}
          style={{
            padding: '6px 12px',
            fontSize: 13,
            backgroundColor: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6,
            color: 'var(--text-primary, #f5f5f7)',
            cursor: newPath.trim() ? 'pointer' : 'default',
            opacity: newPath.trim() ? 1 : 0.5,
          }}
        >
          Add Project
        </button>
      </div>

      {/* Hidden projects */}
      {hiddenPaths.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-secondary, #8e8e93)', marginBottom: 8 }}>
            Hidden Projects ({hiddenPaths.length})
          </div>
          {hiddenPaths.map((path) => {
            const name = path.split('/').filter(Boolean).pop() ?? path;
            return (
              <div
                key={path}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  opacity: 0.6,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12 }}>{name}</div>
                  <div title={path} style={{ fontSize: 10, color: 'var(--color-tertiary, #aeaeb2)' }}>{path}</div>
                </div>
                <button
                  onClick={() => unhideProject(path)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#22c55e',
                    cursor: 'pointer',
                    fontSize: 11,
                    padding: '4px 8px',
                  }}
                >
                  Restore
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// MARK: - Assistants Section

interface ServerAssistant {
  id: string;
  displayName: string;
  installCommand: string;
}

function AssistantsSection({
  settings,
  health,
  onSave,
}: {
  settings: Settings;
  health: HealthResponse['dependencies'] | null;
  onSave: (patch: Partial<Settings>) => Promise<void>;
}): React.ReactElement {
  const [serverAssistants, setServerAssistants] = useState<ServerAssistant[]>([]);

  useEffect(() => {
    api.getAssistants()
      .then((res: any) => {
        setServerAssistants((res.assistants ?? []).map((a: any) => ({
          id: a.id,
          displayName: a.displayName,
          installCommand: a.installCommand ?? '',
        })));
      })
      .catch(() => {});
  }, []);

  const getAvailable = (id: string): boolean => {
    return health?.assistantAvailability?.[id] ?? false;
  };

  const toggleAssistant = useCallback((assistantId: string) => {
    const current = settings.enabledAssistants;
    const enabled = current.includes(assistantId as CodingAssistant)
      ? current.filter(a => a !== assistantId)
      : [...current, assistantId as CodingAssistant];
    onSave({ enabledAssistants: enabled });
  }, [settings.enabledAssistants, onSave]);

  const assistants = serverAssistants.length > 0 ? serverAssistants : ALL_ASSISTANTS.map(a => ({
    id: a, displayName: getDisplayName(a), installCommand: getInstallCommand(a),
  }));

  return (
    <div data-testid="settings-assistants">
      <SectionHeader title="Coding Assistants" description="Enable the assistants you want to use. Only available CLIs can be launched." />

      {assistants.map((assistant) => {
        const available = getAvailable(assistant.id);
        const enabled = settings.enabledAssistants.includes(assistant.id as CodingAssistant);

        return (
          <div
            key={assistant.id}
            data-testid={`assistant-row-${assistant.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 0',
              borderBottom: '1px solid var(--border-secondary, rgba(255,255,255,0.06))',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={() => toggleAssistant(assistant.id)}
                data-testid={`toggle-${assistant.id}`}
                style={{ accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{assistant.displayName}</span>
            </label>
            {available ? (
              <span data-testid={`status-${assistant.id}`} style={{ fontSize: 11, color: 'var(--success, #22c55e)' }}>
                CLI Available
              </span>
            ) : (
              <span data-testid={`status-${assistant.id}`} style={{ fontSize: 11, color: 'var(--warning, #f97316)' }}>
                Not Installed
              </span>
            )}
          </div>
        );
      })}

      {/* Install hints for missing CLIs */}
      {assistants.filter(a => !getAvailable(a.id) && settings.enabledAssistants.includes(a.id as CodingAssistant)).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--color-secondary, #8e8e93)', marginBottom: 6 }}>
            Install missing assistants:
          </div>
          {assistants.filter(a => !getAvailable(a.id) && settings.enabledAssistants.includes(a.id as CodingAssistant)).map(a => (
            <div key={a.id} style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--warning, #f97316)', padding: '4px 0' }}>
              {a.installCommand}
            </div>
          ))}
        </div>
      )}

      {/* Hooks */}
      {health && (
        <HooksSettingsSection health={health} enabledAssistants={settings.enabledAssistants} />
      )}
    </div>
  );
}

// MARK: - Hooks Settings Section

const HOOK_CONFIG: Record<string, { configPath: string; events: string[]; format: 'nested' | 'flat' }> = {
  claude: { configPath: '~/.claude/settings.json', events: ['Stop', 'Notification', 'SessionStart', 'SessionEnd', 'UserPromptSubmit'], format: 'nested' },
  gemini: { configPath: '~/.gemini/settings.json', events: ['AfterAgent', 'Notification', 'SessionStart', 'SessionEnd', 'BeforeAgent'], format: 'nested' },
  kiro: { configPath: '~/.kiro/agents/kanban_code.json', events: ['stop', 'userPromptSubmit', 'agentSpawn'], format: 'flat' },
};

function buildHookSnippet(assistant: string): string {
  const cfg = HOOK_CONFIG[assistant];
  if (!cfg) return '// Unknown assistant';
  const script = '~/.kanban-code/hook.sh';
  const hooks: Record<string, unknown> = {};
  for (const event of cfg.events) {
    if (cfg.format === 'flat') {
      hooks[event] = [{ command: script }];
    } else {
      hooks[event] = [{ matcher: '', hooks: [{ type: 'command', command: script }] }];
    }
  }
  return JSON.stringify({ hooks }, null, 2);
}

function HooksSettingsSection({
  health,
  enabledAssistants,
}: {
  health: HealthResponse['dependencies'];
  enabledAssistants: CodingAssistant[];
}): React.ReactElement {
  const [hookStatus, setHookStatus] = useState<Record<string, boolean>>(health.assistantHooks ?? {});
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [hookError, setHookError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState<string | null>(null);

  const handleInstall = useCallback(async (assistant: string) => {
    setInstalling(prev => ({ ...prev, [assistant]: true }));
    setHookError(null);
    try {
      await api.installHooks(assistant);
      const status = await api.getHookStatus();
      setHookStatus(status.hooks);
    } catch (err) {
      setHookError(`Failed to install ${getDisplayName(assistant)} hooks: ${err}`);
    }
    setInstalling(prev => ({ ...prev, [assistant]: false }));
  }, []);

  const handleUninstall = useCallback(async (assistant: string) => {
    setInstalling(prev => ({ ...prev, [assistant]: true }));
    setHookError(null);
    try {
      await api.uninstallHooks(assistant);
      const status = await api.getHookStatus();
      setHookStatus(status.hooks);
    } catch (err) {
      setHookError(`Failed to uninstall ${getDisplayName(assistant)} hooks: ${err}`);
    }
    setInstalling(prev => ({ ...prev, [assistant]: false }));
  }, []);

  return (
    <div style={{ marginTop: 16 }}>
      <SectionHeader
        title="Hooks"
        description="Hooks let Kanban detect session activity in real time. The hook script at ~/.kanban-code/hook.sh is called by each assistant on start, stop, and attention events."
      />

      {enabledAssistants.map(assistant => {
        const installed = hookStatus[assistant] ?? false;
        const isLoading = installing[assistant] ?? false;
        const cfg = HOOK_CONFIG[assistant];

        return (
          <div key={assistant} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ color: installed ? '#22c55e' : '#f97316' }}>
                {installed ? '\u2713' : '\u25CB'}
              </span>
              <span style={{ flex: 1 }}>{getDisplayName(assistant)}</span>
              <span style={{ fontSize: 11, color: installed ? '#22c55e' : '#f97316', marginRight: 8 }}>
                {installed ? 'Installed' : 'Not installed'}
              </span>
              {installed ? (
                <button
                  onClick={() => handleUninstall(assistant)}
                  disabled={isLoading}
                  style={{
                    padding: '4px 10px', fontSize: 11, background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4,
                    color: 'var(--color-secondary, #8e8e93)', cursor: 'pointer',
                    opacity: isLoading ? 0.5 : 1,
                  }}
                >
                  {isLoading ? '...' : 'Uninstall'}
                </button>
              ) : (
                <button
                  onClick={() => handleInstall(assistant)}
                  disabled={isLoading}
                  style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 500,
                    backgroundColor: 'var(--color-accent, #007AFF)', color: '#fff',
                    border: 'none', borderRadius: 4, cursor: 'pointer',
                    opacity: isLoading ? 0.5 : 1,
                  }}
                >
                  {isLoading ? 'Installing...' : 'Install'}
                </button>
              )}
            </div>

            {/* Manual instructions toggle */}
            {cfg && (
              <div style={{ paddingLeft: 22, marginTop: 4 }}>
                <button
                  onClick={() => setShowManual(showManual === assistant ? null : assistant)}
                  style={{ background: 'none', border: 'none', color: 'var(--color-accent, #007AFF)', fontSize: 11, cursor: 'pointer', padding: 0 }}
                >
                  {showManual === assistant ? '\u25BC' : '\u25B6'} Manual instructions
                </button>
                {showManual === assistant && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-secondary, #8e8e93)', lineHeight: 1.6 }}>
                    <div style={{ marginBottom: 6 }}>
                      Add to <code style={{ fontFamily: 'monospace', fontSize: 11, backgroundColor: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 3 }}>{cfg.configPath}</code>:
                    </div>
                    <pre style={{
                      fontSize: 11, fontFamily: 'monospace',
                      backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 6, padding: 10, overflow: 'auto', maxHeight: 180,
                      whiteSpace: 'pre', margin: 0,
                    }}>
                      {buildHookSnippet(assistant)}
                    </pre>
                    <div style={{ marginTop: 6, fontStyle: 'italic' }}>
                      Merge the &quot;hooks&quot; key into your existing config. Do not overwrite other settings.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {hookError && (
        <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{hookError}</div>
      )}
    </div>
  );
}

// MARK: - General Section

function GeneralSection({
  settings,
  health,
  onSave,
  backendUrl,
  setBackendUrl,
}: {
  settings: Settings;
  health: HealthResponse['dependencies'] | null;
  onSave: (patch: Partial<Settings>) => Promise<void>;
  backendUrl: string;
  setBackendUrl: (url: string) => void;
}): React.ReactElement {
  const [mergeCommand, setMergeCommand] = useState(settings.github.mergeCommand);
  const [backendUrlDraft, setBackendUrlDraft] = useState(backendUrl);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const backendUrlTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleBackendUrlChange = useCallback((value: string) => {
    setBackendUrlDraft(value);
    if (backendUrlTimerRef.current) clearTimeout(backendUrlTimerRef.current);
    backendUrlTimerRef.current = setTimeout(() => {
      setBackendUrl(value);
    }, 800);
  }, [setBackendUrl]);

  const handleMergeCommandChange = useCallback((value: string) => {
    setMergeCommand(value);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onSave({ github: { ...settings.github, mergeCommand: value } });
    }, 500);
  }, [settings.github, onSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (backendUrlTimerRef.current) clearTimeout(backendUrlTimerRef.current);
    };
  }, []);

  const textSizes = ['Small', 'Medium', 'Large', 'X-Large', 'XX-Large'];

  return (
    <div data-testid="settings-general">
      {/* Backend Connection */}
      <SectionHeader title="Backend Connection" description="Connect the frontend to a backend running on a different machine." />
      <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
        Backend URL
      </label>
      <input
        data-testid="backend-url-input"
        type="text"
        value={backendUrlDraft}
        onChange={(e) => handleBackendUrlChange(e.target.value)}
        placeholder="Leave empty for same origin (default)"
        style={inputStyle}
      />
      <div style={{ fontSize: 11, color: 'var(--color-tertiary, #aeaeb2)', marginTop: 4 }}>
        Example: http://192.168.1.5:3000 — changes take effect immediately
      </div>

      {/* Appearance */}
      <SectionHeader title="Appearance" description="UI text size and font settings." />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
        <label style={{ fontSize: 13 }}>UI text size</label>
        <select
          data-testid="ui-text-size"
          value={settings.appearance.uiTextSize}
          onChange={(e) => onSave({ appearance: { ...settings.appearance, uiTextSize: Number(e.target.value) } })}
          style={{
            padding: '4px 8px',
            fontSize: 13,
            backgroundColor: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 4,
            color: 'var(--text-primary, #f5f5f7)',
          }}
        >
          {textSizes.map((label, i) => (
            <option key={i} value={i}>{label}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
        <label style={{ fontSize: 13 }}>Font size</label>
        <input
          data-testid="font-size-slider"
          type="range"
          min={8}
          max={24}
          step={1}
          value={settings.appearance.sessionDetailFontSize}
          onChange={(e) => onSave({ appearance: { ...settings.appearance, sessionDetailFontSize: Number(e.target.value) } })}
        />
        <span style={{ fontSize: 12, color: 'var(--color-secondary, #8e8e93)', fontVariantNumeric: 'tabular-nums' }}>
          {settings.appearance.sessionDetailFontSize}pt
        </span>
      </div>

      {/* Terminal */}
      <TerminalSettingsSection />

      {/* Integrations */}
      <SectionHeader title="Integrations" description="External tool availability." />
      {health && (
        <>
          <StatusRow label="tmux" available={health.tmuxAvailable} />
          <StatusRow label="GitHub CLI (gh)" available={health.ghAvailable} />
          {health.ghAvailable && !health.ghAuthenticated && (
            <div style={{ fontSize: 12, color: '#f97316', padding: '4px 0 4px 24px' }}>
              gh is installed but not logged in. Run <code>gh auth login</code> in a terminal.
            </div>
          )}
        </>
      )}

      {/* GitHub merge command */}
      <SectionHeader title="PR Merge" description="Template for merging pull requests." />
      <input
        data-testid="merge-command-input"
        type="text"
        value={mergeCommand}
        onChange={(e) => handleMergeCommandChange(e.target.value)}
        style={{
          width: '100%',
          padding: '6px 10px',
          fontSize: 12,
          fontFamily: 'monospace',
          backgroundColor: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6,
          color: 'var(--text-primary, #f5f5f7)',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ fontSize: 11, color: 'var(--color-tertiary, #aeaeb2)', marginTop: 4 }}>
        Use {'${number}'} for the PR number.
      </div>
    </div>
  );
}

// MARK: - Notifications Section

function NotificationsSection({
  settings,
  health,
  onSave,
}: {
  settings: Settings;
  health: HealthResponse['dependencies'] | null;
  onSave: (patch: Partial<Settings>) => Promise<void>;
}): React.ReactElement {
  const [token, setToken] = useState(settings.notifications.pushoverToken ?? '');
  const [userKey, setUserKey] = useState(settings.notifications.pushoverUserKey ?? '');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const scheduleNotificationSave = useCallback((patch: Partial<Settings['notifications']>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onSave({
        notifications: {
          ...settings.notifications,
          ...patch,
        },
      });
    }, 500);
  }, [settings.notifications, onSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return (
    <div data-testid="settings-notifications">
      <SectionHeader title="Pushover" description="Get mobile push notifications when your coding assistant needs attention." />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            data-testid="pushover-enabled"
            checked={settings.notifications.pushoverEnabled}
            onChange={(e) => onSave({ notifications: { ...settings.notifications, pushoverEnabled: e.target.checked } })}
          />
          <span style={{ fontSize: 13 }}>Enable Pushover notifications</span>
        </label>
      </div>

      {settings.notifications.pushoverEnabled && (
        <>
          <div style={{ padding: '4px 0' }}>
            <input
              data-testid="pushover-token"
              type="text"
              value={token}
              placeholder="App Token"
              onChange={(e) => {
                setToken(e.target.value);
                scheduleNotificationSave({ pushoverToken: e.target.value || null });
              }}
              style={inputStyle}
            />
          </div>
          <div style={{ padding: '4px 0' }}>
            <input
              data-testid="pushover-user-key"
              type="text"
              value={userKey}
              placeholder="User Key"
              onChange={(e) => {
                setUserKey(e.target.value);
                scheduleNotificationSave({ pushoverUserKey: e.target.value || null });
              }}
              style={inputStyle}
            />
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-tertiary, #aeaeb2)', padding: '4px 0' }}>
            Get your keys at pushover.net
          </div>

          {/* Render markdown image toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0 8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                data-testid="render-markdown"
                checked={settings.notifications.renderMarkdownImage}
                onChange={(e) => onSave({
                  notifications: { ...settings.notifications, renderMarkdownImage: e.target.checked },
                })}
                disabled={!token || !userKey}
              />
              <span style={{ fontSize: 13 }}>Render full output as markdown image</span>
            </label>
          </div>

          {settings.notifications.renderMarkdownImage && health && (
            <div style={{ paddingLeft: 24 }}>
              <StatusRow label="pandoc" available={health.pandocAvailable} />
              <StatusRow label="wkhtmltoimage" available={health.wkhtmltoimageAvailable} />
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
        <StatusRow label="Browser Notifications" available />
        <div style={{ fontSize: 11, color: 'var(--color-tertiary, #aeaeb2)', paddingLeft: 24 }}>
          Always available as fallback.
        </div>
      </div>
    </div>
  );
}

// MARK: - Remote Section

function RemoteSection({
  settings,
  health,
  onSave,
}: {
  settings: Settings;
  health: HealthResponse['dependencies'] | null;
  onSave: (patch: Partial<Settings>) => Promise<void>;
}): React.ReactElement {
  const [host, setHost] = useState(settings.remote?.host ?? '');
  const [remotePath, setRemotePath] = useState(settings.remote?.remotePath ?? '');
  const [localPath, setLocalPath] = useState(settings.remote?.localPath ?? '');
  const [syncIgnores, setSyncIgnores] = useState(
    (settings.remote?.syncIgnores ?? []).join('\n'),
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const scheduleRemoteSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (!host && !remotePath && !localPath) {
        onSave({ remote: null });
      } else {
        const ignores = syncIgnores
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean);
        onSave({
          remote: {
            host,
            remotePath,
            localPath,
            syncIgnores: ignores.length > 0 ? ignores : undefined,
          },
        });
      }
    }, 500);
  }, [host, remotePath, localPath, syncIgnores, onSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return (
    <div data-testid="settings-remote">
      <SectionHeader title="Remote Execution" description="Configure SSH remote host for running sessions remotely." />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
        <input
          data-testid="remote-host"
          type="text"
          value={host}
          placeholder="Remote Host (e.g. user@hostname)"
          onChange={(e) => { setHost(e.target.value); scheduleRemoteSave(); }}
          style={inputStyle}
        />
        <input
          data-testid="remote-path"
          type="text"
          value={remotePath}
          placeholder="Remote Path"
          onChange={(e) => { setRemotePath(e.target.value); scheduleRemoteSave(); }}
          style={inputStyle}
        />
        <input
          data-testid="local-path"
          type="text"
          value={localPath}
          placeholder="Local Path"
          onChange={(e) => { setLocalPath(e.target.value); scheduleRemoteSave(); }}
          style={inputStyle}
        />
      </div>

      {host && health && !health.mutagenAvailable && (
        <div style={{ padding: '8px 0' }}>
          <StatusRow label="Mutagen" available={false} />
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#f97316', paddingLeft: 24 }}>
            brew install mutagen
          </div>
        </div>
      )}

      <SectionHeader title="Sync Ignores" description="Patterns excluded from mutagen sync (one per line)." />
      <textarea
        data-testid="sync-ignores"
        value={syncIgnores}
        onChange={(e) => { setSyncIgnores(e.target.value); scheduleRemoteSave(); }}
        rows={6}
        style={{
          width: '100%',
          padding: '8px 10px',
          fontSize: 12,
          fontFamily: 'monospace',
          backgroundColor: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6,
          color: 'var(--text-primary, #f5f5f7)',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

// MARK: - Terminal Settings Section

function TerminalSettingsSection(): React.ReactElement {
  const [mouseMode, setMouseMode] = useState(
    () => localStorage.getItem('terminalMouseMode') ?? 'browser',
  );
  const [scrollSpeed, setScrollSpeed] = useState(
    () => Number(localStorage.getItem('terminalScrollSpeed')) || 3,
  );

  const handleMouseModeChange = useCallback((mode: string) => {
    localStorage.setItem('terminalMouseMode', mode);
    setMouseMode(mode);
    // Reload so all terminals pick up the new mouse mode immediately
    window.location.reload();
  }, []);

  const handleScrollSpeedChange = useCallback((speed: number) => {
    localStorage.setItem('terminalScrollSpeed', String(speed));
    setScrollSpeed(speed);
  }, []);

  return (
    <>
      <SectionHeader
        title="Terminal"
        description="Mouse behavior in embedded terminals."
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            data-testid="terminal-browser-selection"
            checked={mouseMode === 'browser'}
            onChange={(e) => handleMouseModeChange(e.target.checked ? 'browser' : 'tmux')}
          />
          <span style={{ fontSize: 13 }}>Browser-like text selection</span>
        </label>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-tertiary, #aeaeb2)', paddingLeft: 24, marginBottom: 8 }}>
        {mouseMode === 'browser'
          ? 'Drag to select text, right-click to copy. Tmux mouse features (pane click) are disabled.'
          : 'Tmux handles mouse events. Hold Shift and drag to select text.'}
      </div>

      {mouseMode === 'browser' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0 8px 24px' }}>
          <label style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Scroll speed</label>
          <input
            data-testid="terminal-scroll-speed"
            type="range"
            min={1}
            max={10}
            step={1}
            value={scrollSpeed}
            onChange={(e) => handleScrollSpeedChange(Number(e.target.value))}
            style={{ flex: 1, maxWidth: 200 }}
          />
          <span style={{ fontSize: 12, color: 'var(--color-secondary, #8e8e93)', fontVariantNumeric: 'tabular-nums', minWidth: 16, textAlign: 'right' }}>
            {scrollSpeed}
          </span>
        </div>
      )}
    </>
  );
}

// MARK: - Shared Sub-Components

function SectionHeader({ title, description }: { title: string; description: string }): React.ReactElement {
  return (
    <div style={{ marginTop: 16, marginBottom: 8 }}>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
      <div style={{ fontSize: 12, color: 'var(--color-secondary, #8e8e93)', marginTop: 2 }}>
        {description}
      </div>
    </div>
  );
}

function StatusRow({ label, available }: { label: string; available: boolean }): React.ReactElement {
  return (
    <div
      data-testid={`status-${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}
    >
      <span style={{ color: available ? '#22c55e' : 'var(--color-secondary, #8e8e93)' }}>
        {available ? '\u2713' : '\u25CB'}
      </span>
      <span>{label}</span>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: available ? '#22c55e' : '#f97316' }}>
        {available ? 'Available' : 'Not found'}
      </span>
    </div>
  );
}

// MARK: - Shared Styles

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  backgroundColor: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  color: 'var(--text-primary, #f5f5f7)',
  boxSizing: 'border-box',
};
