import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import LaunchConfirmationDialog from '../LaunchConfirmationDialog';
import type { LaunchParams } from '../LaunchConfirmationDialog';

describe('LaunchConfirmationDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onLaunch: vi.fn(),
    projectPath: '/Users/dev/my-project',
    initialPrompt: 'Fix the login bug',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders nothing when isOpen is false', () => {
      const { container } = render(
        <LaunchConfirmationDialog {...defaultProps} isOpen={false} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders the dialog when isOpen is true', () => {
      render(<LaunchConfirmationDialog {...defaultProps} />);
      expect(screen.getByTestId('launch-dialog')).toBeDefined();
    });

    it('shows "Launch Session" title', () => {
      render(<LaunchConfirmationDialog {...defaultProps} />);
      expect(screen.getByText('Launch Session')).toBeDefined();
    });

    it('shows "Resume Session" title when isResume', () => {
      render(
        <LaunchConfirmationDialog
          {...defaultProps}
          isResume
          sessionId="sess-123"
        />,
      );
      expect(screen.getByText('Resume Session')).toBeDefined();
    });

    it('shows project path', () => {
      render(<LaunchConfirmationDialog {...defaultProps} />);
      expect(screen.getByTestId('project-path').textContent).toBe(
        '/Users/dev/my-project',
      );
    });

    it('shows session ID for resume', () => {
      render(
        <LaunchConfirmationDialog
          {...defaultProps}
          isResume
          sessionId="sess-abc"
        />,
      );
      expect(screen.getByText('sess-abc')).toBeDefined();
    });
  });

  describe('Prompt editor', () => {
    it('shows editable prompt for launch', () => {
      render(<LaunchConfirmationDialog {...defaultProps} />);
      const input = screen.getByTestId('prompt-input') as HTMLTextAreaElement;
      expect(input.value).toBe('Fix the login bug');
    });

    it('hides prompt editor for resume', () => {
      render(
        <LaunchConfirmationDialog
          {...defaultProps}
          isResume
          sessionId="s1"
        />,
      );
      expect(screen.queryByTestId('prompt-input')).toBeNull();
    });

    it('allows editing the prompt', () => {
      render(<LaunchConfirmationDialog {...defaultProps} />);
      const input = screen.getByTestId('prompt-input') as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: 'New prompt' } });
      expect(input.value).toBe('New prompt');
    });
  });

  describe('Checkboxes', () => {
    it('shows worktree checkbox when isGitRepo and not resume', () => {
      render(
        <LaunchConfirmationDialog {...defaultProps} isGitRepo />,
      );
      expect(screen.getByTestId('checkbox-worktree')).toBeDefined();
    });

    it('disables worktree checkbox when not a git repo', () => {
      render(
        <LaunchConfirmationDialog {...defaultProps} isGitRepo={false} />,
      );
      const checkbox = screen.getByTestId('checkbox-worktree') as HTMLInputElement;
      expect(checkbox.disabled).toBe(true);
    });

    it('hides worktree for resume', () => {
      render(
        <LaunchConfirmationDialog
          {...defaultProps}
          isResume
          sessionId="s1"
          isGitRepo
        />,
      );
      expect(screen.queryByTestId('checkbox-worktree')).toBeNull();
    });

    it('shows branch input when worktree is checked and git repo', () => {
      render(
        <LaunchConfirmationDialog {...defaultProps} isGitRepo />,
      );
      // Default: worktree is checked
      expect(screen.getByTestId('branch-input')).toBeDefined();
    });

    it('shows remote checkbox', () => {
      render(<LaunchConfirmationDialog {...defaultProps} />);
      expect(screen.getByTestId('checkbox-remote')).toBeDefined();
    });

    it('disables remote when no remote config', () => {
      render(
        <LaunchConfirmationDialog {...defaultProps} hasRemoteConfig={false} />,
      );
      const checkbox = screen.getByTestId('checkbox-remote') as HTMLInputElement;
      expect(checkbox.disabled).toBe(true);
    });

    it('enables remote when hasRemoteConfig', () => {
      render(
        <LaunchConfirmationDialog {...defaultProps} hasRemoteConfig />,
      );
      const checkbox = screen.getByTestId('checkbox-remote') as HTMLInputElement;
      expect(checkbox.disabled).toBe(false);
    });

    it('shows skip permissions checkbox', () => {
      render(<LaunchConfirmationDialog {...defaultProps} />);
      expect(screen.getByTestId('checkbox-permissions')).toBeDefined();
    });
  });

  describe('Command preview', () => {
    it('shows command preview', () => {
      render(<LaunchConfirmationDialog {...defaultProps} />);
      const textarea = screen.getByTestId('command-preview') as HTMLTextAreaElement;
      expect(textarea.value).toContain('claude');
    });

    it('includes --dangerously-skip-permissions by default', () => {
      render(<LaunchConfirmationDialog {...defaultProps} />);
      const textarea = screen.getByTestId('command-preview') as HTMLTextAreaElement;
      expect(textarea.value).toContain('--dangerously-skip-permissions');
    });

    it('includes --worktree when worktree enabled and isGitRepo', () => {
      render(
        <LaunchConfirmationDialog {...defaultProps} isGitRepo />,
      );
      const textarea = screen.getByTestId('command-preview') as HTMLTextAreaElement;
      expect(textarea.value).toContain('--worktree');
    });

    it('includes resume command for resume mode', () => {
      render(
        <LaunchConfirmationDialog
          {...defaultProps}
          isResume
          sessionId="sess-xyz"
        />,
      );
      const textarea = screen.getByTestId('command-preview') as HTMLTextAreaElement;
      expect(textarea.value).toContain('--resume');
      expect(textarea.value).toContain('sess-xyz');
    });

    it('includes SHELL env for remote', () => {
      render(
        <LaunchConfirmationDialog {...defaultProps} hasRemoteConfig />,
      );
      const textarea = screen.getByTestId('command-preview') as HTMLTextAreaElement;
      expect(textarea.value).toContain('SHELL=~/.kanban-code/remote/zsh');
    });

    it('shows gemini command for gemini assistant', () => {
      render(
        <LaunchConfirmationDialog {...defaultProps} assistant="gemini" />,
      );
      const textarea = screen.getByTestId('command-preview') as HTMLTextAreaElement;
      expect(textarea.value).toContain('gemini');
      expect(textarea.value).toContain('--yolo');
    });
  });

  describe('Buttons', () => {
    it('shows Launch button for new sessions', () => {
      render(<LaunchConfirmationDialog {...defaultProps} />);
      expect(screen.getByTestId('btn-launch').textContent).toBe('Launch');
    });

    it('shows Resume button for resume', () => {
      render(
        <LaunchConfirmationDialog
          {...defaultProps}
          isResume
          sessionId="s1"
        />,
      );
      expect(screen.getByTestId('btn-launch').textContent).toBe('Resume');
    });

    it('disables Launch when prompt is empty', () => {
      render(
        <LaunchConfirmationDialog
          {...defaultProps}
          initialPrompt=""
        />,
      );
      const btn = screen.getByTestId('btn-launch') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('does NOT disable Resume even with empty prompt', () => {
      render(
        <LaunchConfirmationDialog
          {...defaultProps}
          isResume
          sessionId="s1"
          initialPrompt=""
        />,
      );
      const btn = screen.getByTestId('btn-launch') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it('calls onClose when Cancel clicked', () => {
      const onClose = vi.fn();
      render(
        <LaunchConfirmationDialog {...defaultProps} onClose={onClose} />,
      );
      fireEvent.click(screen.getByTestId('btn-cancel'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onLaunch with correct params when launched', () => {
      const onLaunch = vi.fn();
      const onClose = vi.fn();
      render(
        <LaunchConfirmationDialog
          {...defaultProps}
          onLaunch={onLaunch}
          onClose={onClose}
          isGitRepo
        />,
      );
      fireEvent.click(screen.getByTestId('btn-launch'));
      expect(onLaunch).toHaveBeenCalledOnce();
      const params: LaunchParams = onLaunch.mock.calls[0][0];
      expect(params.prompt).toBe('Fix the login bug');
      expect(params.createWorktree).toBe(true);
      expect(params.skipPermissions).toBe(true);
      expect(params.commandOverride).toBeNull();
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('passes commandOverride when command manually edited', () => {
      const onLaunch = vi.fn();
      render(
        <LaunchConfirmationDialog
          {...defaultProps}
          onLaunch={onLaunch}
        />,
      );
      const cmdInput = screen.getByTestId('command-preview') as HTMLTextAreaElement;
      fireEvent.change(cmdInput, { target: { value: 'custom command here' } });
      fireEvent.click(screen.getByTestId('btn-launch'));
      const params: LaunchParams = onLaunch.mock.calls[0][0];
      expect(params.commandOverride).toBe('custom command here');
    });
  });
});
