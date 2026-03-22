/**
 * QueuedPromptsBar -- horizontal bar listing queued prompts for a card.
 *
 * Swift source: Sources/KanbanCode/QueuedPromptsBar.swift
 *
 * Features: lists queued prompts, "Send Now" button, edit/remove buttons,
 * bolt icon for auto-send prompts.
 */

import React from 'react';
import type { QueuedPrompt } from '@kanban-code/shared';

// MARK: - Props

export interface QueuedPromptsBarProps {
  prompts: QueuedPrompt[];
  onSendNow: (promptId: string) => void;
  onEdit: (prompt: QueuedPrompt) => void;
  onRemove: (promptId: string) => void;
}

// MARK: - Component

export default function QueuedPromptsBar({
  prompts,
  onSendNow,
  onEdit,
  onRemove,
}: QueuedPromptsBarProps): React.ReactElement {
  return (
    <div
      data-testid="queued-prompts-bar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '4px 0',
        backdropFilter: 'blur(8px)',
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
      }}
    >
      {prompts.map((prompt, index) => (
        <React.Fragment key={prompt.id}>
          <div
            data-testid={`queued-prompt-${prompt.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
            }}
          >
            {prompt.sendAutomatically && (
              <span
                data-testid="auto-send-icon"
                title="Will send automatically when Claude finishes"
                style={{ fontSize: 9, color: '#f97316' }}
              >
                &#x26A1;
              </span>
            )}

            <span
              title={prompt.body}
              style={{
                flex: 1,
                fontSize: 12,
                lineHeight: '1.4',
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical' as const,
              }}
            >
              {prompt.body}
            </span>

            <button
              data-testid={`send-now-${prompt.id}`}
              onClick={() => onSendNow(prompt.id)}
              style={{
                fontSize: 10,
                padding: '2px 8px',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 4,
                backgroundColor: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Send Now
            </button>

            <button
              data-testid={`edit-prompt-${prompt.id}`}
              onClick={() => onEdit(prompt)}
              title="Edit prompt"
              style={iconButtonStyle}
              aria-label="Edit prompt"
            >
              &#x270E;
            </button>

            <button
              data-testid={`remove-prompt-${prompt.id}`}
              onClick={() => onRemove(prompt.id)}
              title="Remove prompt"
              style={{ ...iconButtonStyle, opacity: 0.5 }}
              aria-label="Remove prompt"
            >
              &#x2715;
            </button>
          </div>

          {index < prompts.length - 1 && (
            <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0 12px' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

const iconButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 10,
  padding: '2px 4px',
  lineHeight: 1,
};
