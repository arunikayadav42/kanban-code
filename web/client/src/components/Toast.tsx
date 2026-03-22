import React, { useEffect } from 'react';

export interface ToastProps {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
}

export default function Toast({ message, onDismiss, durationMs = 3000 }: ToastProps): React.ReactElement | null {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [message, onDismiss, durationMs]);

  if (!message) return null;

  return (
    <div
      data-testid="toast"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '10px 20px',
        fontSize: 13,
        fontWeight: 500,
        color: '#fff',
        backgroundColor: 'rgba(30, 30, 30, 0.95)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        zIndex: 2000,
        pointerEvents: 'auto',
      }}
    >
      {message}
    </div>
  );
}
