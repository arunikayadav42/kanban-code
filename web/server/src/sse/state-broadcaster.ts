import type { Response } from 'express';
import { info } from '../infrastructure/logger.js';

/**
 * Server-Sent Events broadcaster — pushes named events to all connected clients.
 * 150ms debounce for background changes, immediate flush for user actions.
 *
 * Spec: Section 3.2 (SSE), Section 7.6 (sseDebounceWindow = 150ms)
 */

const DEBOUNCE_MS = 150;

interface SSEClient {
  id: string;
  res: Response;
}

let clients: SSEClient[] = [];
let debounceBuffer: Array<{ event: string; data: string }> = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let clientIdCounter = 0;

/** Register a new SSE client connection. */
export function addClient(res: Response): string {
  const id = `sse-${++clientIdCounter}`;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Send a comment to establish connection
  res.write(':connected\n\n');

  clients.push({ id, res });
  info('sse', `Client connected: ${id} (total: ${clients.length})`);

  // Remove client on disconnect
  res.on('close', () => {
    clients = clients.filter(c => c.id !== id);
    info('sse', `Client disconnected: ${id} (total: ${clients.length})`);
  });

  return id;
}

/** Send a named SSE event to all connected clients immediately. */
export function sendEvent(event: string, data: unknown): void {
  const json = JSON.stringify(data);
  const message = `event: ${event}\ndata: ${json}\n\n`;

  for (const client of clients) {
    try {
      client.res.write(message);
    } catch {
      // Client disconnected — will be cleaned up on 'close' event
    }
  }
}

/** Queue an event for debounced broadcast (150ms window for background changes). */
export function queueEvent(event: string, data: unknown): void {
  debounceBuffer.push({ event, data: JSON.stringify(data) });

  if (!debounceTimer) {
    debounceTimer = setTimeout(flushDebounceBuffer, DEBOUNCE_MS);
  }
}

/** Flush the debounce buffer immediately (for user-initiated changes). */
export function flushDebounceBuffer(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (debounceBuffer.length === 0) return;

  const events = debounceBuffer;
  debounceBuffer = [];

  for (const { event, data } of events) {
    const message = `event: ${event}\ndata: ${data}\n\n`;
    for (const client of clients) {
      try {
        client.res.write(message);
      } catch { /* disconnected */ }
    }
  }
}

/** Get current client count. */
export function getClientCount(): number {
  return clients.length;
}

/** Send event and flush buffer (for user-initiated REST mutations). */
export function sendAndFlush(event: string, data: unknown): void {
  flushDebounceBuffer(); // flush any pending background events first
  sendEvent(event, data); // then send the immediate event
}
