/**
 * QueuedPromptDialog -- modal dialog for adding/editing a queued prompt.
 *
 * Swift source: Sources/KanbanCode/QueuedPromptDialog.swift
 *
 * Features: prompt text input, "Send automatically when Claude finishes" toggle,
 * image attachments, save/cancel buttons.
 */

import React, { useState, useCallback, useRef } from 'react';
import type { QueuedPrompt, CodingAssistant, ImageAttachment } from '@kanban-code/shared';
import { getDisplayName, ALL_ASSISTANTS } from '@kanban-code/shared';
import PromptEditor from './PromptEditor';

// MARK: - Props

export interface QueuedPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  existingPrompt?: QueuedPrompt | null;
  assistant?: CodingAssistant;
  onSave: (body: string, sendAutomatically: boolean, images: ImageAttachment[]) => void;
}

// MARK: - Component

export default function QueuedPromptDialog({
  isOpen,
  onClose,
  existingPrompt = null,
  assistant = ALL_ASSISTANTS[0],
  onSave,
}: QueuedPromptDialogProps): React.ReactElement | null {
  const [promptText, setPromptText] = useState(existingPrompt?.body ?? '');
  const [sendAutomatically, setSendAutomatically] = useState(existingPrompt?.sendAutomatically ?? true);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const assistantName = getDisplayName(assistant);
  const isEditing = existingPrompt !== null;
  const isSaveDisabled = promptText.trim().length === 0;

  const handleSubmit = useCallback(() => {
    const trimmed = promptText.trim();
    if (trimmed.length === 0) return;
    onSave(trimmed, sendAutomatically, images);
    onClose();
  }, [promptText, sendAutomatically, images, onSave, onClose]);

  const handleImagePaste = useCallback((blob: Blob) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1] ?? '';
      const attachment: ImageAttachment = {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        data: base64,
      };
      setImages((prev) => [...prev, attachment]);
    };
    reader.readAsDataURL(blob);
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="queued-prompt-dialog-overlay"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: 1000,
      }}
    >
      <div
        data-testid="queued-prompt-dialog"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: 20,
          width: 450,
          maxWidth: '90vw',
          backgroundColor: 'var(--color-surface, #1c1c1e)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Title */}
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
          {isEditing ? 'Edit Queued Prompt' : 'Queue Prompt'}
        </h3>

        {/* Prompt editor */}
        <div
          style={{
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <PromptEditor
            value={promptText}
            onChange={setPromptText}
            placeholder={`Type the next prompt for ${assistantName}...`}
            maxHeight={300}
            onSubmit={handleSubmit}
            onImagePaste={handleImagePaste}
            autoFocus
          />
        </div>

        {/* Image attachments preview */}
        {images.length > 0 && (
          <div
            data-testid="image-attachments"
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
          >
            {images.map((img) => (
              <div
                key={img.id}
                style={{
                  position: 'relative',
                  width: 48,
                  height: 48,
                  borderRadius: 6,
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <img
                  src={`data:image/png;base64,${img.data}`}
                  alt="Attachment"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <button
                  onClick={() => removeImage(img.id)}
                  style={{
                    position: 'absolute',
                    top: -2,
                    right: -2,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: 'none',
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    fontSize: 10,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                  }}
                  aria-label={`Remove image ${img.id}`}
                >
                  &#x2715;
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Auto-send toggle */}
        <label
          data-testid="auto-send-toggle"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={sendAutomatically}
            onChange={(e) => setSendAutomatically(e.target.checked)}
          />
          Send automatically when {assistantName} finishes
        </label>

        {/* Hidden file input for future image upload button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImagePaste(file);
          }}
        />

        {/* Action buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            data-testid="dialog-cancel"
            onClick={onClose}
            style={{
              padding: '6px 16px',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6,
              backgroundColor: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Cancel
          </button>
          <button
            data-testid="dialog-save"
            onClick={handleSubmit}
            disabled={isSaveDisabled}
            style={{
              padding: '6px 16px',
              border: 'none',
              borderRadius: 6,
              backgroundColor: isSaveDisabled ? 'rgba(0, 122, 255, 0.3)' : '#007AFF',
              color: '#fff',
              cursor: isSaveDisabled ? 'default' : 'pointer',
              fontSize: 14,
              fontWeight: 500,
              opacity: isSaveDisabled ? 0.5 : 1,
            }}
          >
            {isEditing ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
