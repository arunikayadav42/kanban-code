import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AddLinkPopover from '../AddLinkPopover';

describe('AddLinkPopover', () => {
  describe('Rendering', () => {
    it('renders the popover', () => {
      render(<AddLinkPopover />);
      expect(screen.getByTestId('add-link-popover')).toBeDefined();
    });

    it('shows Add Link title', () => {
      render(<AddLinkPopover />);
      expect(screen.getByText('Add Link')).toBeDefined();
    });

    it('shows segmented picker with Branch, Issue, PR', () => {
      render(<AddLinkPopover />);
      expect(screen.getByTestId('picker-branch')).toBeDefined();
      expect(screen.getByTestId('picker-issue')).toBeDefined();
      expect(screen.getByTestId('picker-pr')).toBeDefined();
    });

    it('defaults to Branch tab', () => {
      render(<AddLinkPopover />);
      expect(screen.getByTestId('branch-input')).toBeDefined();
    });
  });

  describe('Tab switching', () => {
    it('shows branch input on Branch tab', () => {
      render(<AddLinkPopover />);
      fireEvent.click(screen.getByTestId('picker-branch'));
      expect(screen.getByTestId('branch-input')).toBeDefined();
      expect(screen.queryByTestId('number-input')).toBeNull();
    });

    it('shows number input on Issue tab', () => {
      render(<AddLinkPopover />);
      fireEvent.click(screen.getByTestId('picker-issue'));
      expect(screen.getByTestId('number-input')).toBeDefined();
      expect(screen.queryByTestId('branch-input')).toBeNull();
    });

    it('shows number input on PR tab', () => {
      render(<AddLinkPopover />);
      fireEvent.click(screen.getByTestId('picker-pr'));
      expect(screen.getByTestId('number-input')).toBeDefined();
      expect(screen.queryByTestId('branch-input')).toBeNull();
    });

    it('shows # prefix for number input', () => {
      render(<AddLinkPopover />);
      fireEvent.click(screen.getByTestId('picker-issue'));
      expect(screen.getByText('#')).toBeDefined();
    });
  });

  describe('Add button state', () => {
    it('disables Add when branch input is empty', () => {
      render(<AddLinkPopover />);
      const addBtn = screen.getByTestId('add-link-button') as HTMLButtonElement;
      expect(addBtn.disabled).toBe(true);
    });

    it('enables Add when branch has text', () => {
      render(<AddLinkPopover />);
      fireEvent.change(screen.getByTestId('branch-input'), { target: { value: 'feat/new' } });
      const addBtn = screen.getByTestId('add-link-button') as HTMLButtonElement;
      expect(addBtn.disabled).toBe(false);
    });

    it('disables Add when number is empty', () => {
      render(<AddLinkPopover />);
      fireEvent.click(screen.getByTestId('picker-issue'));
      const addBtn = screen.getByTestId('add-link-button') as HTMLButtonElement;
      expect(addBtn.disabled).toBe(true);
    });

    it('enables Add when number is valid', () => {
      render(<AddLinkPopover />);
      fireEvent.click(screen.getByTestId('picker-issue'));
      fireEvent.change(screen.getByTestId('number-input'), { target: { value: '42' } });
      const addBtn = screen.getByTestId('add-link-button') as HTMLButtonElement;
      expect(addBtn.disabled).toBe(false);
    });

    it('disables Add when number is not numeric', () => {
      render(<AddLinkPopover />);
      fireEvent.click(screen.getByTestId('picker-issue'));
      fireEvent.change(screen.getByTestId('number-input'), { target: { value: 'abc' } });
      const addBtn = screen.getByTestId('add-link-button') as HTMLButtonElement;
      expect(addBtn.disabled).toBe(true);
    });

    it('disables Add when number is zero', () => {
      render(<AddLinkPopover />);
      fireEvent.click(screen.getByTestId('picker-issue'));
      fireEvent.change(screen.getByTestId('number-input'), { target: { value: '0' } });
      const addBtn = screen.getByTestId('add-link-button') as HTMLButtonElement;
      expect(addBtn.disabled).toBe(true);
    });

    it('disables Add when only whitespace in branch', () => {
      render(<AddLinkPopover />);
      fireEvent.change(screen.getByTestId('branch-input'), { target: { value: '   ' } });
      const addBtn = screen.getByTestId('add-link-button') as HTMLButtonElement;
      expect(addBtn.disabled).toBe(true);
    });
  });

  describe('Add branch', () => {
    it('calls onAddBranch with trimmed branch name', () => {
      const onAddBranch = vi.fn();
      render(<AddLinkPopover onAddBranch={onAddBranch} />);
      fireEvent.change(screen.getByTestId('branch-input'), { target: { value: ' feat/auth ' } });
      fireEvent.click(screen.getByTestId('add-link-button'));
      expect(onAddBranch).toHaveBeenCalledWith('feat/auth');
    });

    it('does not call onAddBranch when branch is empty', () => {
      const onAddBranch = vi.fn();
      render(<AddLinkPopover onAddBranch={onAddBranch} />);
      fireEvent.click(screen.getByTestId('add-link-button'));
      expect(onAddBranch).not.toHaveBeenCalled();
    });
  });

  describe('Add issue', () => {
    it('calls onAddIssue with number', () => {
      const onAddIssue = vi.fn();
      render(<AddLinkPopover onAddIssue={onAddIssue} />);
      fireEvent.click(screen.getByTestId('picker-issue'));
      fireEvent.change(screen.getByTestId('number-input'), { target: { value: '42' } });
      fireEvent.click(screen.getByTestId('add-link-button'));
      expect(onAddIssue).toHaveBeenCalledWith(42);
    });
  });

  describe('Add PR', () => {
    it('calls onAddPR with number', () => {
      const onAddPR = vi.fn();
      render(<AddLinkPopover onAddPR={onAddPR} />);
      fireEvent.click(screen.getByTestId('picker-pr'));
      fireEvent.change(screen.getByTestId('number-input'), { target: { value: '123' } });
      fireEvent.click(screen.getByTestId('add-link-button'));
      expect(onAddPR).toHaveBeenCalledWith(123);
    });
  });

  describe('Enter key submit', () => {
    it('submits branch on Enter key', () => {
      const onAddBranch = vi.fn();
      render(<AddLinkPopover onAddBranch={onAddBranch} />);
      const input = screen.getByTestId('branch-input');
      fireEvent.change(input, { target: { value: 'main' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onAddBranch).toHaveBeenCalledWith('main');
    });

    it('submits number on Enter key', () => {
      const onAddIssue = vi.fn();
      render(<AddLinkPopover onAddIssue={onAddIssue} />);
      fireEvent.click(screen.getByTestId('picker-issue'));
      const input = screen.getByTestId('number-input');
      fireEvent.change(input, { target: { value: '7' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onAddIssue).toHaveBeenCalledWith(7);
    });

    it('does not submit on Enter when disabled', () => {
      const onAddBranch = vi.fn();
      render(<AddLinkPopover onAddBranch={onAddBranch} />);
      const input = screen.getByTestId('branch-input');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onAddBranch).not.toHaveBeenCalled();
    });
  });
});
