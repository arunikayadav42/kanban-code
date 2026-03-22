/**
 * NewTaskDialog -- form for creating a new task card.
 *
 * Prompt input, title, project picker, start immediately toggle,
 * launch options (worktree, remote, skip permissions, custom branch),
 * assistant picker, command preview.
 *
 * Swift source: Sources/KanbanCode/NewTaskDialog.swift
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { CodingAssistant, Project } from '@kanban-code/shared';
import {
  ALL_ASSISTANTS,
  getCliCommand,
  getAutoApproveFlag,
  getSupportsWorktree,
  getDisplayName,
  getNeedsRemotePathOverride,
} from '@kanban-code/shared';

// MARK: - Props

export interface NewTaskDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projects?: Project[];
  defaultProjectPath?: string | null;
  enabledAssistants?: CodingAssistant[];
  hasRemoteConfig?: boolean;
  /** Called when creating WITHOUT starting immediately */
  onCreate?: (params: CreateParams) => void;
  /** Called when creating AND starting immediately */
  onCreateAndLaunch?: (params: CreateAndLaunchParams) => void;
}

export interface CreateParams {
  prompt: string;
  projectPath: string | null;
  title: string | null;
  startImmediately: boolean;
}

export interface CreateAndLaunchParams {
  prompt: string;
  projectPath: string | null;
  title: string | null;
  createWorktree: boolean;
  runRemotely: boolean;
  skipPermissions: boolean;
  commandOverride: string | null;
  assistant: CodingAssistant;
}

const CUSTOM_PATH_SENTINEL = '__custom__';

// MARK: - Component

export default function NewTaskDialog({
  isOpen,
  onClose,
  projects = [],
  defaultProjectPath = null,
  enabledAssistants = ALL_ASSISTANTS as unknown as CodingAssistant[],
  hasRemoteConfig = false,
  onCreate,
  onCreateAndLaunch,
}: NewTaskDialogProps): React.ReactElement | null {
  // State
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [selectedProjectPath, setSelectedProjectPath] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [selectedAssistant, setSelectedAssistant] = useState<CodingAssistant>(enabledAssistants[0] ?? 'claude');
  const [startImmediately, setStartImmediately] = useState(true);
  const [createWorktree, setCreateWorktree] = useState(true);
  const [worktreeBranch, setWorktreeBranch] = useState('');
  const [runRemotely, setRunRemotely] = useState(true);
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [command, setCommand] = useState('');
  const [commandEdited, setCommandEdited] = useState(false);

  // Reset form on open
  useEffect(() => {
    if (isOpen) {
      setPrompt('');
      setTitle('');
      setCustomPath('');
      setCommandEdited(false);
      setWorktreeBranch('');

      // Restore project selection
      if (defaultProjectPath && projects.some((p) => p.path === defaultProjectPath)) {
        setSelectedProjectPath(defaultProjectPath);
      } else if (projects.length > 0) {
        setSelectedProjectPath(projects[0].path);
      } else {
        setSelectedProjectPath('');
      }

      // Ensure assistant is in enabled list
      if (!enabledAssistants.includes(selectedAssistant) && enabledAssistants.length > 0) {
        setSelectedAssistant(enabledAssistants[0]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Derived
  const resolvedProjectPath = useMemo(() => {
    if (projects.length === 0) return customPath || null;
    if (selectedProjectPath === CUSTOM_PATH_SENTINEL) return customPath || null;
    return selectedProjectPath || null;
  }, [projects.length, selectedProjectPath, customPath]);

  const isGitRepo = resolvedProjectPath != null && resolvedProjectPath.length > 0;

  const supportsWorktree = getSupportsWorktree(selectedAssistant);

  // Command preview
  const commandPreview = useMemo(() => {
    const parts: string[] = [];

    if (runRemotely && hasRemoteConfig) {
      parts.push('SHELL=~/.kanban-code/remote/zsh');
      if (getNeedsRemotePathOverride(selectedAssistant)) {
        parts.push('PATH=~/.kanban-code/remote:$PATH');
      }
    }

    let cmd = getCliCommand(selectedAssistant);
    if (skipPermissions) cmd += ` ${getAutoApproveFlag(selectedAssistant)}`;

    if (createWorktree && isGitRepo && supportsWorktree) {
      const branch = worktreeBranch.trim();
      if (branch) {
        cmd += ` --worktree ${branch}`;
      } else {
        cmd += ' --worktree';
      }
    }

    parts.push(cmd);
    return parts.join(' \\\n  ');
  }, [
    runRemotely, hasRemoteConfig, selectedAssistant, skipPermissions,
    createWorktree, isGitRepo, supportsWorktree, worktreeBranch,
  ]);

  // Keep command synced with preview unless manually edited
  useEffect(() => {
    if (!commandEdited) {
      setCommand(commandPreview);
    }
  }, [commandPreview, commandEdited]);

  const handleCommandChange = useCallback(
    (value: string) => {
      setCommand(value);
      if (value !== commandPreview) {
        setCommandEdited(true);
      }
    },
    [commandPreview],
  );

  const handleSubmit = useCallback(() => {
    if (prompt.trim() === '') return;
    const proj = resolvedProjectPath;
    const titleOrNull = title.trim() || null;

    if (startImmediately) {
      onCreateAndLaunch?.({
        prompt,
        projectPath: proj,
        title: titleOrNull,
        createWorktree: createWorktree && isGitRepo && supportsWorktree,
        runRemotely: runRemotely && hasRemoteConfig,
        skipPermissions,
        commandOverride: commandEdited ? command : null,
        assistant: selectedAssistant,
      });
    } else {
      onCreate?.({
        prompt,
        projectPath: proj,
        title: titleOrNull,
        startImmediately: false,
      });
    }
    onClose();
  }, [
    prompt, resolvedProjectPath, title, startImmediately,
    createWorktree, isGitRepo, supportsWorktree, runRemotely,
    hasRemoteConfig, skipPermissions, commandEdited, command,
    selectedAssistant, onCreateAndLaunch, onCreate, onClose,
  ]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="new-task-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 200,
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-tertiary, #2c2c2e)',
          borderRadius: 12,
          padding: 20,
          width: 450,
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600 }}>
          New Task
        </h2>

        {/* Prompt */}
        <textarea
          data-testid="prompt-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={`Describe what you want ${getDisplayName(selectedAssistant)} to do...`}
          rows={4}
          style={{
            width: '100%',
            padding: 8,
            fontSize: 13,
            lineHeight: 1.5,
            backgroundColor: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            color: 'var(--text-primary, #f5f5f7)',
            resize: 'vertical',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            marginBottom: 12,
          }}
        />

        {/* Title */}
        <input
          data-testid="title-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: 13,
            backgroundColor: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            color: 'var(--text-primary, #f5f5f7)',
            boxSizing: 'border-box',
            marginBottom: 12,
          }}
        />

        {/* Project picker */}
        {projects.length === 0 ? (
          <input
            data-testid="custom-path-input"
            type="text"
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            placeholder="Project path (optional)"
            style={{
              width: '100%',
              padding: '6px 8px',
              fontSize: 12,
              backgroundColor: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: 'var(--text-primary, #f5f5f7)',
              boxSizing: 'border-box',
              marginBottom: 12,
            }}
          />
        ) : (
          <div style={{ marginBottom: 12 }}>
            <select
              data-testid="project-picker"
              value={selectedProjectPath}
              onChange={(e) => setSelectedProjectPath(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                fontSize: 13,
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: 'var(--text-primary, #f5f5f7)',
              }}
            >
              {projects.map((proj) => (
                <option key={proj.path} value={proj.path}>
                  {proj.name}
                </option>
              ))}
              <option value={CUSTOM_PATH_SENTINEL}>Custom path...</option>
            </select>
            {selectedProjectPath === CUSTOM_PATH_SENTINEL && (
              <input
                data-testid="custom-path-input"
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="Project path"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: 12,
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 6,
                  color: 'var(--text-primary, #f5f5f7)',
                  boxSizing: 'border-box',
                  marginTop: 8,
                }}
              />
            )}
          </div>
        )}

        {/* Start immediately toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 12 }}>
          <input
            data-testid="checkbox-start-immediately"
            type="checkbox"
            checked={startImmediately}
            onChange={(e) => setStartImmediately(e.target.checked)}
          />
          Start immediately
        </label>

        {/* Launch options (when start immediately) */}
        {startImmediately && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {/* Create worktree */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: isGitRepo && supportsWorktree ? 'pointer' : 'default' }}>
              <input
                data-testid="checkbox-worktree"
                type="checkbox"
                checked={isGitRepo && supportsWorktree ? createWorktree : false}
                onChange={(e) => setCreateWorktree(e.target.checked)}
                disabled={!isGitRepo || !supportsWorktree}
              />
              Create worktree
            </label>
            {!isGitRepo && (
              <span style={{ fontSize: 11, color: 'var(--color-tertiary, #aeaeb2)', paddingLeft: 28 }}>
                Not a git repository
              </span>
            )}
            {isGitRepo && !supportsWorktree && (
              <span style={{ fontSize: 11, color: 'var(--color-tertiary, #aeaeb2)', paddingLeft: 28 }}>
                {getDisplayName(selectedAssistant)} doesn't support worktrees
              </span>
            )}
            {createWorktree && isGitRepo && supportsWorktree && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 28 }}>
                <span style={{ fontSize: 13, color: 'var(--color-secondary, #8e8e93)' }}>Branch</span>
                <input
                  data-testid="branch-input"
                  type="text"
                  value={worktreeBranch}
                  onChange={(e) => setWorktreeBranch(e.target.value)}
                  placeholder="Leave empty for a random name"
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    fontSize: 12,
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 4,
                    color: 'var(--text-primary, #f5f5f7)',
                  }}
                />
              </div>
            )}

            {/* Run remotely */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: hasRemoteConfig ? 'pointer' : 'default' }}>
              <input
                data-testid="checkbox-remote"
                type="checkbox"
                checked={hasRemoteConfig ? runRemotely : false}
                onChange={(e) => setRunRemotely(e.target.checked)}
                disabled={!hasRemoteConfig}
              />
              Run remotely
            </label>
            {!hasRemoteConfig && (
              <span style={{ fontSize: 11, color: 'var(--color-tertiary, #aeaeb2)', paddingLeft: 28 }}>
                Configure remote execution in Settings {'>'} Remote
              </span>
            )}

            {/* Skip permissions */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                data-testid="checkbox-permissions"
                type="checkbox"
                checked={skipPermissions}
                onChange={(e) => setSkipPermissions(e.target.checked)}
              />
              Dangerously skip permissions
            </label>

            {/* Command preview */}
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-secondary, #8e8e93)', display: 'block', marginBottom: 4 }}>
                Command
              </label>
              <textarea
                data-testid="command-preview"
                value={command}
                onChange={(e) => handleCommandChange(e.target.value)}
                rows={2}
                style={{
                  width: '100%',
                  padding: 8,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  lineHeight: 1.4,
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 6,
                  color: 'var(--text-primary, #f5f5f7)',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Assistant picker (when start immediately + multiple assistants) */}
          {startImmediately && enabledAssistants.length > 1 && (
            <select
              data-testid="assistant-picker"
              value={selectedAssistant}
              onChange={(e) => setSelectedAssistant(e.target.value as CodingAssistant)}
              style={{
                padding: '4px 8px',
                fontSize: 12,
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: 'var(--text-primary, #f5f5f7)',
              }}
            >
              {enabledAssistants.map((a) => (
                <option key={a} value={a}>{getDisplayName(a)}</option>
              ))}
            </select>
          )}

          <span style={{ flex: 1 }} />

          <button
            data-testid="btn-cancel"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              backgroundColor: 'transparent',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              color: 'var(--text-primary, #f5f5f7)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            data-testid="btn-submit"
            onClick={handleSubmit}
            disabled={prompt.trim() === ''}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              backgroundColor: 'var(--color-accent, #007AFF)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              cursor: prompt.trim() === '' ? 'not-allowed' : 'pointer',
              opacity: prompt.trim() === '' ? 0.5 : 1,
            }}
          >
            {startImmediately ? 'Create & Start' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
