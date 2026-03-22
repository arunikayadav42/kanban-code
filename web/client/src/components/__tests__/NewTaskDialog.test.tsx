import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import NewTaskDialog from '../NewTaskDialog';
import type { CreateParams, CreateAndLaunchParams } from '../NewTaskDialog';
import type { Project } from '@kanban-code/shared';

describe('NewTaskDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onCreate: vi.fn(),
    onCreateAndLaunch: vi.fn(),
  };

  const testProjects: Project[] = [
    { path: '/Users/dev/alpha', name: 'alpha', visible: true },
    { path: '/Users/dev/beta', name: 'beta', visible: true },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders nothing when isOpen is false', () => {
      const { container } = render(
        <NewTaskDialog {...defaultProps} isOpen={false} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders the dialog when isOpen is true', () => {
      render(<NewTaskDialog {...defaultProps} />);
      expect(screen.getByTestId('new-task-dialog')).toBeDefined();
    });

    it('shows "New Task" title', () => {
      render(<NewTaskDialog {...defaultProps} />);
      expect(screen.getByText('New Task')).toBeDefined();
    });
  });

  describe('Form fields', () => {
    it('shows prompt textarea', () => {
      render(<NewTaskDialog {...defaultProps} />);
      expect(screen.getByTestId('prompt-input')).toBeDefined();
    });

    it('shows title input', () => {
      render(<NewTaskDialog {...defaultProps} />);
      expect(screen.getByTestId('title-input')).toBeDefined();
    });

    it('shows custom path input when no projects', () => {
      render(<NewTaskDialog {...defaultProps} projects={[]} />);
      expect(screen.getByTestId('custom-path-input')).toBeDefined();
    });

    it('shows project picker when projects provided', () => {
      render(<NewTaskDialog {...defaultProps} projects={testProjects} />);
      expect(screen.getByTestId('project-picker')).toBeDefined();
    });

    it('shows start immediately checkbox (checked by default)', () => {
      render(<NewTaskDialog {...defaultProps} />);
      const cb = screen.getByTestId('checkbox-start-immediately') as HTMLInputElement;
      expect(cb.checked).toBe(true);
    });
  });

  describe('Start immediately toggle', () => {
    it('shows launch options when start immediately is checked', () => {
      render(<NewTaskDialog {...defaultProps} />);
      expect(screen.getByTestId('checkbox-worktree')).toBeDefined();
      expect(screen.getByTestId('checkbox-remote')).toBeDefined();
      expect(screen.getByTestId('checkbox-permissions')).toBeDefined();
      expect(screen.getByTestId('command-preview')).toBeDefined();
    });

    it('hides launch options when start immediately unchecked', () => {
      render(<NewTaskDialog {...defaultProps} />);
      fireEvent.click(screen.getByTestId('checkbox-start-immediately'));
      expect(screen.queryByTestId('checkbox-worktree')).toBeNull();
      expect(screen.queryByTestId('command-preview')).toBeNull();
    });

    it('changes submit button text when toggled', () => {
      render(<NewTaskDialog {...defaultProps} />);
      expect(screen.getByTestId('btn-submit').textContent).toBe('Create & Start');
      fireEvent.click(screen.getByTestId('checkbox-start-immediately'));
      expect(screen.getByTestId('btn-submit').textContent).toBe('Create');
    });
  });

  describe('Worktree checkbox', () => {
    it('shows "Not a git repository" when no project selected', () => {
      render(<NewTaskDialog {...defaultProps} projects={[]} />);
      expect(screen.getByText('Not a git repository')).toBeDefined();
    });

    it('shows branch input when worktree checked and has project', () => {
      render(
        <NewTaskDialog
          {...defaultProps}
          projects={testProjects}
          defaultProjectPath="/Users/dev/alpha"
        />,
      );
      expect(screen.getByTestId('branch-input')).toBeDefined();
    });
  });

  describe('Remote checkbox', () => {
    it('disables remote when hasRemoteConfig is false', () => {
      render(<NewTaskDialog {...defaultProps} hasRemoteConfig={false} />);
      const cb = screen.getByTestId('checkbox-remote') as HTMLInputElement;
      expect(cb.disabled).toBe(true);
    });

    it('enables remote when hasRemoteConfig is true', () => {
      render(<NewTaskDialog {...defaultProps} hasRemoteConfig />);
      const cb = screen.getByTestId('checkbox-remote') as HTMLInputElement;
      expect(cb.disabled).toBe(false);
    });
  });

  describe('Assistant picker', () => {
    it('shows assistant picker when start immediately and multiple assistants', () => {
      render(
        <NewTaskDialog
          {...defaultProps}
          enabledAssistants={['claude', 'gemini']}
        />,
      );
      expect(screen.getByTestId('assistant-picker')).toBeDefined();
    });

    it('hides assistant picker when only one assistant', () => {
      render(
        <NewTaskDialog
          {...defaultProps}
          enabledAssistants={['claude']}
        />,
      );
      expect(screen.queryByTestId('assistant-picker')).toBeNull();
    });

    it('hides assistant picker when not starting immediately', () => {
      render(
        <NewTaskDialog
          {...defaultProps}
          enabledAssistants={['claude', 'gemini']}
        />,
      );
      fireEvent.click(screen.getByTestId('checkbox-start-immediately'));
      expect(screen.queryByTestId('assistant-picker')).toBeNull();
    });
  });

  describe('Command preview', () => {
    it('shows claude command by default', () => {
      render(<NewTaskDialog {...defaultProps} />);
      const cmd = screen.getByTestId('command-preview') as HTMLTextAreaElement;
      expect(cmd.value).toContain('claude');
    });

    it('updates command when assistant changes', () => {
      render(
        <NewTaskDialog
          {...defaultProps}
          enabledAssistants={['claude', 'gemini']}
        />,
      );
      const picker = screen.getByTestId('assistant-picker');
      fireEvent.change(picker, { target: { value: 'gemini' } });
      const cmd = screen.getByTestId('command-preview') as HTMLTextAreaElement;
      expect(cmd.value).toContain('gemini');
    });
  });

  describe('Submit', () => {
    it('disables submit when prompt is empty', () => {
      render(<NewTaskDialog {...defaultProps} />);
      const btn = screen.getByTestId('btn-submit') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('enables submit when prompt has content', () => {
      render(<NewTaskDialog {...defaultProps} />);
      fireEvent.change(screen.getByTestId('prompt-input'), {
        target: { value: 'Do something' },
      });
      const btn = screen.getByTestId('btn-submit') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it('calls onCreateAndLaunch when start immediately', () => {
      const onCreateAndLaunch = vi.fn();
      render(
        <NewTaskDialog
          {...defaultProps}
          onCreateAndLaunch={onCreateAndLaunch}
          projects={testProjects}
          defaultProjectPath="/Users/dev/alpha"
        />,
      );
      fireEvent.change(screen.getByTestId('prompt-input'), {
        target: { value: 'Build feature' },
      });
      fireEvent.click(screen.getByTestId('btn-submit'));
      expect(onCreateAndLaunch).toHaveBeenCalledOnce();
      const params: CreateAndLaunchParams = onCreateAndLaunch.mock.calls[0][0];
      expect(params.prompt).toBe('Build feature');
      expect(params.projectPath).toBe('/Users/dev/alpha');
      expect(params.assistant).toBe('claude');
    });

    it('calls onCreate when not starting immediately', () => {
      const onCreate = vi.fn();
      render(
        <NewTaskDialog {...defaultProps} onCreate={onCreate} />,
      );
      fireEvent.change(screen.getByTestId('prompt-input'), {
        target: { value: 'Do stuff' },
      });
      fireEvent.click(screen.getByTestId('checkbox-start-immediately'));
      fireEvent.click(screen.getByTestId('btn-submit'));
      expect(onCreate).toHaveBeenCalledOnce();
      const params: CreateParams = onCreate.mock.calls[0][0];
      expect(params.prompt).toBe('Do stuff');
      expect(params.startImmediately).toBe(false);
    });

    it('passes title when provided', () => {
      const onCreateAndLaunch = vi.fn();
      render(
        <NewTaskDialog
          {...defaultProps}
          onCreateAndLaunch={onCreateAndLaunch}
        />,
      );
      fireEvent.change(screen.getByTestId('prompt-input'), {
        target: { value: 'Do it' },
      });
      fireEvent.change(screen.getByTestId('title-input'), {
        target: { value: 'My Task' },
      });
      fireEvent.click(screen.getByTestId('btn-submit'));
      const params: CreateAndLaunchParams = onCreateAndLaunch.mock.calls[0][0];
      expect(params.title).toBe('My Task');
    });

    it('closes dialog on submit', () => {
      const onClose = vi.fn();
      render(<NewTaskDialog {...defaultProps} onClose={onClose} />);
      fireEvent.change(screen.getByTestId('prompt-input'), {
        target: { value: 'Something' },
      });
      fireEvent.click(screen.getByTestId('btn-submit'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('closes dialog on cancel', () => {
      const onClose = vi.fn();
      render(<NewTaskDialog {...defaultProps} onClose={onClose} />);
      fireEvent.click(screen.getByTestId('btn-cancel'));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('Project picker', () => {
    it('selects default project path on open', () => {
      render(
        <NewTaskDialog
          {...defaultProps}
          projects={testProjects}
          defaultProjectPath="/Users/dev/beta"
        />,
      );
      const picker = screen.getByTestId('project-picker') as HTMLSelectElement;
      expect(picker.value).toBe('/Users/dev/beta');
    });

    it('falls back to first project when default not in list', () => {
      render(
        <NewTaskDialog
          {...defaultProps}
          projects={testProjects}
          defaultProjectPath="/nonexistent"
        />,
      );
      const picker = screen.getByTestId('project-picker') as HTMLSelectElement;
      expect(picker.value).toBe('/Users/dev/alpha');
    });

    it('shows custom path input when Custom path selected', () => {
      render(
        <NewTaskDialog {...defaultProps} projects={testProjects} />,
      );
      const picker = screen.getByTestId('project-picker');
      fireEvent.change(picker, { target: { value: '__custom__' } });
      expect(screen.getByTestId('custom-path-input')).toBeDefined();
    });
  });
});
