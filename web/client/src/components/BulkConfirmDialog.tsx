import React from 'react';

export interface BulkConfirmDialogProps {
  isOpen: boolean;
  title: string;
  cardNames: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export default function BulkConfirmDialog({
  isOpen,
  title,
  cardNames,
  onConfirm,
  onCancel,
}: BulkConfirmDialogProps): React.ReactElement | null {
  if (!isOpen) return null;

  const maxVisible = 10;
  const visible = cardNames.slice(0, maxVisible);
  const remaining = cardNames.length - maxVisible;

  return (
    <div
      data-testid="bulk-confirm-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
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
        data-testid="bulk-confirm-dialog"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 20,
          width: 400,
          maxWidth: '90vw',
          backgroundColor: 'var(--color-surface, #1c1c1e)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>

        <div
          style={{
            maxHeight: 200,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {visible.map((name, i) => (
            <div
              key={i}
              title={name}
              style={{
                fontSize: 12,
                color: 'var(--color-secondary, #8e8e93)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                padding: '2px 0',
              }}
            >
              {name}
            </div>
          ))}
          {remaining > 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-tertiary, #aeaeb2)', fontStyle: 'italic' }}>
              +{remaining} more
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            data-testid="bulk-confirm-cancel"
            onClick={onCancel}
            style={{
              padding: '6px 16px',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6,
              backgroundColor: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            data-testid="bulk-confirm-ok"
            onClick={onConfirm}
            style={{
              padding: '6px 16px',
              border: 'none',
              borderRadius: 6,
              backgroundColor: '#007AFF',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
