/**
 * WebSocket manager for terminal connections.
 * Binary frames = terminal data, text frames = JSON control.
 *
 * Spec: Section 3.1 (Terminal WebSocket)
 */
import type { TerminalServerMessage } from '@kanban-code/shared';
import { useBoardStore } from '../store/index.js';

export interface TerminalWSCallbacks {
  onData: (data: Uint8Array) => void;
  onExit: (code: number, signal?: number) => void;
  onClose: () => void;
  onError: (error: Event) => void;
}

export class TerminalWS {
  private ws: WebSocket | null = null;
  private callbacks: TerminalWSCallbacks;
  private sessionName: string | null = null;
  private intentionalClose = false;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_RETRIES = 5;
  private static readonly BASE_DELAY_MS = 1000;

  constructor(callbacks: TerminalWSCallbacks) {
    this.callbacks = callbacks;
  }

  connect(sessionName: string): void {
    this.sessionName = sessionName;
    this.intentionalClose = false;
    this.doConnect(sessionName);
  }

  private getWsUrl(sessionName: string): string {
    const backendUrl = useBoardStore.getState().backendUrl;
    if (backendUrl && /^https?:\/\/.+/.test(backendUrl)) {
      try {
        const url = new URL(backendUrl);
        const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${url.host}/ws/terminal/${encodeURIComponent(sessionName)}`;
      } catch { /* invalid URL — fall through to window.location */ }
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/terminal/${encodeURIComponent(sessionName)}`;
  }

  private doConnect(sessionName: string): void {
    const url = this.getWsUrl(sessionName);

    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.retryCount = 0; // Reset on successful connect
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.callbacks.onData(new Uint8Array(event.data));
      } else {
        try {
          const msg = JSON.parse(event.data) as TerminalServerMessage;
          if (msg.type === 'exit') {
            this.intentionalClose = true; // PTY exited — don't reconnect
            this.callbacks.onExit(msg.code ?? 0, msg.signal ?? 0);
          } else if (msg.type === 'error') {
            this.intentionalClose = true; // Server error — don't reconnect
            this.callbacks.onError(new Event(msg.message ?? 'PTY error'));
          }
        } catch {
          // Ignore malformed control messages
        }
      }
    };

    this.ws.onclose = () => {
      if (!this.intentionalClose && this.sessionName && this.retryCount < TerminalWS.MAX_RETRIES) {
        const delay = TerminalWS.BASE_DELAY_MS * Math.pow(2, this.retryCount);
        this.retryCount++;
        this.retryTimer = setTimeout(() => this.doConnect(this.sessionName!), delay);
      } else {
        this.callbacks.onClose();
      }
    };

    this.ws.onerror = (err) => {
      this.callbacks.onError(err);
    };
  }

  /** Send terminal input (keystrokes) as binary frame. */
  send(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Binary frame → server routes to PTY stdin
      this.ws.send(new TextEncoder().encode(data));
    }
  }

  /** Send resize control message as text frame (NOT binary). */
  resize(cols: number, rows: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Text frame (string) → server parses as JSON control message
      // MUST be a string, not Uint8Array, so server sees isBinary=false
      const msg = JSON.stringify({ type: 'resize', cols, rows });
      this.ws.send(msg);
    }
  }

  /** Close the connection (intentional — no reconnect). */
  disconnect(): void {
    this.intentionalClose = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.sessionName = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
