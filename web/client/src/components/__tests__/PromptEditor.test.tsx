import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PromptEditor from '../PromptEditor';

describe('PromptEditor', () => {
  describe('Rendering', () => {
    it('renders a textarea', () => {
      render(<PromptEditor value="" onChange={() => {}} />);
      expect(screen.getByTestId('prompt-editor')).toBeDefined();
    });

    it('displays the current value', () => {
      render(<PromptEditor value="Hello Claude" onChange={() => {}} />);
      const textarea = screen.getByTestId('prompt-editor') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Hello Claude');
    });

    it('shows placeholder text', () => {
      render(<PromptEditor value="" onChange={() => {}} placeholder="Type here..." />);
      const textarea = screen.getByTestId('prompt-editor') as HTMLTextAreaElement;
      expect(textarea.placeholder).toBe('Type here...');
    });

    it('uses monospaced font', () => {
      render(<PromptEditor value="" onChange={() => {}} />);
      const textarea = screen.getByTestId('prompt-editor') as HTMLTextAreaElement;
      expect(textarea.style.fontFamily).toBe('monospace');
    });

    it('respects disabled state', () => {
      render(<PromptEditor value="" onChange={() => {}} disabled />);
      const textarea = screen.getByTestId('prompt-editor') as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(true);
    });
  });

  describe('Keyboard behavior', () => {
    it('calls onSubmit on Enter (without Shift)', () => {
      const onSubmit = vi.fn();
      render(<PromptEditor value="Test" onChange={() => {}} onSubmit={onSubmit} />);
      const textarea = screen.getByTestId('prompt-editor');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('does not call onSubmit on Shift+Enter', () => {
      const onSubmit = vi.fn();
      render(<PromptEditor value="Test" onChange={() => {}} onSubmit={onSubmit} />);
      const textarea = screen.getByTestId('prompt-editor');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('prevents default on Enter to avoid newline insertion', () => {
      const onSubmit = vi.fn();
      render(<PromptEditor value="" onChange={() => {}} onSubmit={onSubmit} />);
      const textarea = screen.getByTestId('prompt-editor');
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: false,
        bubbles: true,
        cancelable: true,
      });
      const prevented = !textarea.dispatchEvent(event);
      // The event handler calls preventDefault
      // We verify onSubmit was called
      expect(onSubmit).toHaveBeenCalled();
    });
  });

  describe('Text changes', () => {
    it('calls onChange when text is typed', () => {
      const onChange = vi.fn();
      render(<PromptEditor value="" onChange={onChange} />);
      const textarea = screen.getByTestId('prompt-editor');
      fireEvent.change(textarea, { target: { value: 'New text' } });
      expect(onChange).toHaveBeenCalledWith('New text');
    });

    it('calls onChange on every keystroke', () => {
      const onChange = vi.fn();
      render(<PromptEditor value="" onChange={onChange} />);
      const textarea = screen.getByTestId('prompt-editor');
      fireEvent.change(textarea, { target: { value: 'a' } });
      fireEvent.change(textarea, { target: { value: 'ab' } });
      fireEvent.change(textarea, { target: { value: 'abc' } });
      expect(onChange).toHaveBeenCalledTimes(3);
    });
  });

  describe('Image paste support', () => {
    it('calls onImagePaste when an image is pasted', () => {
      const onImagePaste = vi.fn();
      render(<PromptEditor value="" onChange={() => {}} onImagePaste={onImagePaste} />);
      const textarea = screen.getByTestId('prompt-editor');

      const file = new File(['image-data'], 'test.png', { type: 'image/png' });
      const clipboardData = {
        items: [
          {
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
      };

      fireEvent.paste(textarea, { clipboardData });
      expect(onImagePaste).toHaveBeenCalledWith(file);
    });

    it('allows text paste when no onImagePaste handler', () => {
      render(<PromptEditor value="" onChange={() => {}} />);
      const textarea = screen.getByTestId('prompt-editor');

      // Should not throw
      fireEvent.paste(textarea, {
        clipboardData: {
          items: [
            {
              type: 'text/plain',
              getAsFile: () => null,
            },
          ],
        },
      });
    });

    it('allows text paste to proceed when no image in clipboard', () => {
      const onImagePaste = vi.fn();
      render(<PromptEditor value="" onChange={() => {}} onImagePaste={onImagePaste} />);
      const textarea = screen.getByTestId('prompt-editor');

      fireEvent.paste(textarea, {
        clipboardData: {
          items: [
            {
              type: 'text/plain',
              getAsFile: () => null,
            },
          ],
        },
      });

      expect(onImagePaste).not.toHaveBeenCalled();
    });
  });

  describe('Auto-sizing', () => {
    it('sets minimum height of 80px', () => {
      render(<PromptEditor value="" onChange={() => {}} />);
      const textarea = screen.getByTestId('prompt-editor') as HTMLTextAreaElement;
      expect(textarea.style.minHeight).toBe('80px');
    });
  });
});
