/**
 * LaunchConfirmationDialog -- pre-launch confirmation dialog.
 *
 * Shows editable prompt, create worktree checkbox, run remotely checkbox,
 * skip permissions checkbox, command preview (updates live).
 * Also used for resume (shows resume command with remote toggle).
 *
 * Swift source: Sources/KanbanCode/LaunchConfirmationDialog.swift
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { CodingAssistant } from '@kanban-code/shared';
import {
  ALL_ASSISTANTS,
  getCliCommand,
  getAutoApproveFlag,
  getResumeFlag,
  getSupportsWorktree,
  getDisplayName,
  getNeedsRemotePathOverride,
} from '@kanban-code/shared';

// MARK: - Props

export interface LaunchConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunch: (params: LaunchParams) => void;

  projectPath: string;
  initialPrompt: string;
  worktreeName?: string | null;
  hasExistingWorktree?: boolean;
  isGitRepo?: boolean;
  hasRemoteConfig?: boolean;
  remoteHost?: string | null;
  isResume?: boolean;
  sessionId?: string | null;
  assistant?: CodingAssistant;
}

export interface LaunchParams {
  prompt: string;
  createWorktree: boolean;
  worktreeBranch: string | null;
  runRemotely: boolean;
  skipPermissions: boolean;
  commandOverride: string | null;
}

// MARK: - Component

export default function LaunchConfirmationDialog({
  isOpen,
  onClose,
  onLaunch,
  projectPath,
  initialPrompt,
  worktreeName = null,
  hasExistingWorktree = false,
  isGitRepo = false,
  hasRemoteConfig = false,
  remoteHost = null,
  isResume = false,
  sessionId = null,
  assistant = ALL_ASSISTANTS[0],
}: LaunchConfirmationDialogProps): React.ReactElement | null {
  // Local state
  const [prompt, setPrompt] = useState(initialPrompt);
  const [createWorktree, setCreateWorktree] = useState(true);
  const [worktreeBranch, setWorktreeBranch] = useState('');
  const [runRemotely, setRunRemotely] = useState(true);
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [command, setCommand] = useState('');
  const [commandEdited, setCommandEdited] = useState(false);

  // Reset when dialog opens
  useEffect(() => {
    if (isOpen) {
      setPrompt(initialPrompt);
      setCommandEdited(false);
      setWorktreeBranch('');
    }
  }, [isOpen, initialPrompt]);

  // Effective values
  const supportsWorktree = getSupportsWorktree(assistant);
  const effectiveCreateWorktree = !isResume && !hasExistingWorktree && createWorktree && isGitRepo && supportsWorktree;
  const effectiveRunRemotely = runRemotely && hasRemoteConfig;

  // Command preview
  const commandPreview = useMemo(() => {
    const parts: string[] = [];

    if (effectiveRunRemotely) {
      parts.push('SHELL=~/.kanban-code/remote/zsh');
      if (getNeedsRemotePathOverride(assistant)) {
        parts.push('PATH=~/.kanban-code/remote:$PATH');
      }
    }

    if (isResume && sessionId) {
      let resumeCmd = getCliCommand(assistant);
      if (skipPermissions) resumeCmd += ` ${getAutoApproveFlag(assistant)}`;
      resumeCmd += ` ${getResumeFlag(assistant)} ${sessionId}`;
      parts.push(`cd ${projectPath} && ${resumeCmd}`);
    } else {
      let cmd = getCliCommand(assistant);
      if (skipPermissions) cmd += ` ${getAutoApproveFlag(assistant)}`;

      if (effectiveCreateWorktree && supportsWorktree) {
        const branch = worktreeBranch.trim();
        if (worktreeName) {
          cmd += ` --worktree ${worktreeName}`;
        } else if (branch) {
          cmd += ` --worktree ${branch}`;
        } else {
          cmd += ' --worktree';
        }
      }

      parts.push(cmd);
    }

    return parts.join(' \\\n  ');
  }, [
    effectiveRunRemotely, effectiveCreateWorktree, isResume, sessionId,
    projectPath, assistant, skipPermissions, worktreeName, worktreeBranch,
    supportsWorktree,
  ]);

  // Sync command with preview when not manually edited
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
    if (!isResume && prompt.trim() === '') return;
    onLaunch({
      prompt,
      createWorktree: effectiveCreateWorktree,
      worktreeBranch: worktreeBranch.trim() || null,
      runRemotely: effectiveRunRemotely,
      skipPermissions,
      commandOverride: commandEdited ? command : null,
    });
    onClose();
  }, [
    isResume, prompt, effectiveCreateWorktree, worktreeBranch,
    effectiveRunRemotely, skipPermissions, commandEdited, command, onLaunch, onClose,
  ]);

  if (!isOpen) return null;

  const assistantLabel = getDisplayName(assistant);

  return (
    <div
      data-testid="launch-dialog"
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
          width: 500,
          maxHeight: 700,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Scrollable content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600 }}>
            {isResume ? 'Resume Session' : 'Launch Session'}
          </h2>

          {/* Project path */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <FolderIcon />
            <span
              data-testid="project-path"
              title={projectPath}
              style={{
                fontSize: 12,
                color: 'var(--color-secondary, #8e8e93)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {projectPath}
            </span>
          </div>

          {/* Worktree name (launch only) */}
          {!isResume && worktreeName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <BranchIcon />
              <span style={{ fontSize: 12, color: 'var(--color-secondary, #8e8e93)' }}>
                {worktreeName}
              </span>
            </div>
          )}

          {/* Session ID (resume only) */}
          {isResume && sessionId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--color-secondary, #8e8e93)' }}>
                {sessionId}
              </span>
            </div>
          )}

          {/* Prompt editor (launch only) */}
          {!isResume && (
            <div style={{ marginBottom: 16 }}>
              <textarea
                data-testid="prompt-input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={`Describe what you want ${assistantLabel} to do...`}
                rows={5}
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
                }}
              />
            </div>
          )}

          {/* Checkboxes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {/* Create worktree (launch only, when no existing worktree) */}
            {!isResume && !hasExistingWorktree && supportsWorktree && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: isGitRepo ? 'pointer' : 'default' }}>
                  <input
                    data-testid="checkbox-worktree"
                    type="checkbox"
                    checked={isGitRepo ? createWorktree : false}
                    onChange={(e) => setCreateWorktree(e.target.checked)}
                    disabled={!isGitRepo}
                  />
                  Create worktree
                </label>
                {!isGitRepo && (
                  <span style={{ fontSize: 11, color: 'var(--color-tertiary, #aeaeb2)', paddingLeft: 28 }}>
                    Not a git repository
                  </span>
                )}
                {createWorktree && isGitRepo && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 28 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-secondary, #8e8e93)' }}>Branch name</span>
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
              </>
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
          </div>

          {/* Command preview */}
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-secondary, #8e8e93)', display: 'block', marginBottom: 4 }}>
              Command
            </label>
            <textarea
              data-testid="command-preview"
              value={command}
              onChange={(e) => handleCommandChange(e.target.value)}
              rows={3}
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

        {/* Buttons (pinned) */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '8px 20px 16px',
          }}
        >
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
            data-testid="btn-launch"
            onClick={handleSubmit}
            disabled={!isResume && prompt.trim() === ''}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              backgroundColor: 'var(--color-accent, #007AFF)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              cursor: !isResume && prompt.trim() === '' ? 'not-allowed' : 'pointer',
              opacity: !isResume && prompt.trim() === '' ? 0.5 : 1,
            }}
          >
            {isResume ? 'Resume' : 'Launch'}
          </button>
        </div>
      </div>
    </div>
  );
}

// MARK: - Icons

function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" opacity={0.5}>
      <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" opacity={0.5}>
      <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6A1 1 0 005 9.5v.878a2.25 2.25 0 11-1.5 0V5.622a2.25 2.25 0 111.5 0v1.878A2.5 2.5 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
    </svg>
  );
}
