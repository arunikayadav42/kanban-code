import { useEffect, useRef } from 'react';
import type { SSEEventType, SSEEventData } from '@kanban-code/shared';
import { SSE_EVENT_TYPES } from '@kanban-code/shared';
import { useBoardStore } from '../store/index.js';

/**
 * React hook for Server-Sent Events connection.
 * Auto-reconnects on disconnect (built into EventSource API).
 *
 * Spec: Section 3.2 (SSE)
 */

interface SSEHandlers {
  onEvent: (event: SSEEventType | string, data: SSEEventData) => void;
  onConnect?: () => void;
  onError?: (error: Event) => void;
}

export function useSSE(handlers: SSEHandlers) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const backendUrl = useBoardStore(s => s.backendUrl);

  useEffect(() => {
    const isValidBackendUrl = (url: string) => {
      try { return /^https?:\/\/.+/.test(url) && Boolean(new URL(url)); } catch { return false; }
    };
    const sseUrl = backendUrl && isValidBackendUrl(backendUrl)
      ? `${backendUrl.replace(/\/$/, '')}/api/events`
      : '/api/events';
    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.onopen = () => handlers.onConnect?.();
    es.onerror = (err) => handlers.onError?.(err);

    // Listen for named events
    const eventTypes: readonly string[] = SSE_EVENT_TYPES;

    // Also listen for action events (dispatched from store)
    const actionHandler = (e: MessageEvent) => {
      try {
        handlers.onEvent(e.type, JSON.parse(e.data));
      } catch { /* ignore parse errors */ }
    };

    for (const type of eventTypes) {
      es.addEventListener(type, actionHandler);
    }

    // Catch-all for any event type starting with "action:"
    es.onmessage = (e) => {
      try {
        handlers.onEvent('message', JSON.parse(e.data));
      } catch { /* ignore */ }
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [backendUrl]);  // eslint-disable-line react-hooks/exhaustive-deps

  return eventSourceRef;
}
