import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import QueuedPromptDialog from '../QueuedPromptDialog';

describe('QueuedPromptDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Visibility', () => {
    it('renders nothing when isOpen is false', () => {
      const { container } = render(
        <QueuedPromptDialog {...defaultProps} isOpen={false} />
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders dialog when isOpen is true', () => {
      render(<QueuedPromptDialog {...defaultProps} />);
      expect(screen.getByTestId('queued-prompt-dialog')).toBeDefined();
    });
  });

  describe('Title', () => {
    it('shows "Queue Prompt" when adding new', () => {
      render(<QueuedPromptDialog {...defaultProps} />);
      expect(screen.getByText('Queue Prompt')).toBeDefined();
    });

    it('shows "Edit Queued Prompt" when editing existing', () => {
      render(
        <QueuedPromptDialog
          {...defaultProps}
          existingPrompt={{ id: 'p1', body: 'test', sendAutomatically: false }}
        />
      );
      expect(screen.getByText('Edit Queued Prompt')).toBeDefined();
    });
  });

  describe('Save button label', () => {
    it('shows "Add" for new prompts', () => {
      render(<QueuedPromptDialog {...defaultProps} />);
      expect(screen.getByTestId('dialog-save').textContent).toBe('Add');
    });

    it('shows "Save" for existing prompts', () => {
      render(
        <QueuedPromptDialog
          {...defaultProps}
          existingPrompt={{ id: 'p1', body: 'test', sendAutomatically: true }}
        />
      );
      expect(screen.getByTestId('dialog-save').textContent).toBe('Save');
    });
  });

  describe('Save button state', () => {
    it('disables save button when text is empty', () => {
      render(<QueuedPromptDialog {...defaultProps} />);
      const saveBtn = screen.getByTestId('dialog-save') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(true);
    });

    it('disables save button when text is only whitespace', () => {
      render(
        <QueuedPromptDialog
          {...defaultProps}
          existingPrompt={{ id: 'p1', body: '   ', sendAutomatically: false }}
        />
      );
      // The existing prompt body is set but trimmed to empty
      // Actually the initial state uses existing body as-is
      // Let us verify the button is enabled since '   ' is set as initial value
      const saveBtn = screen.getByTestId('dialog-save') as HTMLButtonElement;
      // The trim check happens at save time; the disabled check also trims
      expect(saveBtn.disabled).toBe(true);
    });

    it('enables save button when text has content', () => {
      render(
        <QueuedPromptDialog
          {...defaultProps}
          existingPrompt={{ id: 'p1', body: 'valid text', sendAutomatically: false }}
        />
      );
      const saveBtn = screen.getByTestId('dialog-save') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(false);
    });
  });

  describe('Auto-send toggle', () => {
    it('shows auto-send toggle', () => {
      render(<QueuedPromptDialog {...defaultProps} />);
      expect(screen.getByTestId('auto-send-toggle')).toBeDefined();
    });

    it('defaults to checked for new prompts', () => {
      render(<QueuedPromptDialog {...defaultProps} />);
      const checkbox = screen.getByTestId('auto-send-toggle').querySelector('input') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('respects existing prompt sendAutomatically value', () => {
      render(
        <QueuedPromptDialog
          {...defaultProps}
          existingPrompt={{ id: 'p1', body: 'test', sendAutomatically: false }}
        />
      );
      const checkbox = screen.getByTestId('auto-send-toggle').querySelector('input') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('toggles sendAutomatically state', () => {
      render(<QueuedPromptDialog {...defaultProps} />);
      const checkbox = screen.getByTestId('auto-send-toggle').querySelector('input') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);
    });

    it('shows assistant name in toggle label', () => {
      render(<QueuedPromptDialog {...defaultProps} assistant="gemini" />);
      expect(screen.getByText(/Gemini CLI/)).toBeDefined();
    });
  });

  describe('Cancel', () => {
    it('calls onClose when Cancel is clicked', () => {
      const onClose = vi.fn();
      render(<QueuedPromptDialog {...defaultProps} onClose={onClose} />);
      fireEvent.click(screen.getByTestId('dialog-cancel'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when overlay is clicked', () => {
      const onClose = vi.fn();
      render(<QueuedPromptDialog {...defaultProps} onClose={onClose} />);
      fireEvent.click(screen.getByTestId('queued-prompt-dialog-overlay'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when Escape is pressed', () => {
      const onClose = vi.fn();
      render(<QueuedPromptDialog {...defaultProps} onClose={onClose} />);
      fireEvent.keyDown(screen.getByTestId('queued-prompt-dialog-overlay'), { key: 'Escape' });
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('Save', () => {
    it('calls onSave with trimmed text, auto-send, and images on save', () => {
      const onSave = vi.fn();
      const onClose = vi.fn();
      render(
        <QueuedPromptDialog
          {...defaultProps}
          onSave={onSave}
          onClose={onClose}
          existingPrompt={{ id: 'p1', body: 'some text', sendAutomatically: true }}
        />
      );
      fireEvent.click(screen.getByTestId('dialog-save'));
      expect(onSave).toHaveBeenCalledWith('some text', true, []);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not save when text is empty', () => {
      const onSave = vi.fn();
      render(<QueuedPromptDialog {...defaultProps} onSave={onSave} />);
      fireEvent.click(screen.getByTestId('dialog-save'));
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('Existing prompt pre-fill', () => {
    it('pre-fills text from existing prompt', () => {
      render(
        <QueuedPromptDialog
          {...defaultProps}
          existingPrompt={{ id: 'p1', body: 'Pre-filled text', sendAutomatically: false }}
        />
      );
      const editor = screen.getByTestId('prompt-editor') as HTMLTextAreaElement;
      expect(editor.value).toBe('Pre-filled text');
    });
  });
});
