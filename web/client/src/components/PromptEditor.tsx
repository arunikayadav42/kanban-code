/**
 * PromptEditor -- textarea wrapper for sending prompts.
 *
 * Swift source: Sources/KanbanCode/PromptEditor.swift
 *
 * Features: Enter submits, Shift+Enter inserts newline, placeholder text,
 * monospaced font, auto-sizing height, image paste support, undo/redo.
 */

import React, { useRef, useEffect, useCallback } from 'react';

// MARK: - Props

export interface PromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxHeight?: number;
  onSubmit?: () => void;
  onImagePaste?: (data: Blob) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

// MARK: - Component

export default function PromptEditor({
  value,
  onChange,
  placeholder = '',
  maxHeight = 400,
  onSubmit,
  onImagePaste,
  disabled = false,
  autoFocus = false,
}: PromptEditorProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height based on content
  const recalcHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Reset to min to get accurate scrollHeight
    el.style.height = '80px';
    const scrollHeight = el.scrollHeight;
    const newHeight = Math.min(maxHeight, Math.max(80, scrollHeight));
    el.style.height = `${newHeight}px`;
    el.style.overflowY = newHeight >= maxHeight ? 'auto' : 'hidden';
  }, [maxHeight]);

  // Recalc on value or maxHeight change
  useEffect(() => {
    recalcHeight();
  }, [value, recalcHeight]);

  // Auto focus
  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSubmit?.();
        return;
      }
      // Shift+Enter: default behavior inserts newline
    },
    [onSubmit],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onImagePaste) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            onImagePaste(blob);
          }
          return;
        }
      }
      // No image found -- let default text paste proceed
    },
    [onImagePaste],
  );

  return (
    <textarea
      ref={textareaRef}
      data-testid="prompt-editor"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        width: '100%',
        minHeight: 80,
        maxHeight,
        padding: '4px 4px',
        fontFamily: 'monospace',
        fontSize: 'inherit',
        color: 'inherit',
        backgroundColor: 'transparent',
        border: 'none',
        outline: 'none',
        resize: 'none',
        overflowY: 'hidden',
        boxSizing: 'border-box',
      }}
    />
  );
}
