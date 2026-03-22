import { info } from '../../infrastructure/logger.js';
import type { NotifierPort } from '../../domain/ports/notifier.js';

/**
 * Server-side notification fallback -- logs notifications and emits
 * them via SSE so the browser can use the Notification API.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Notifications/MacOSNotificationClient.swift
 * Web equivalent: server logs + SSE push to browser Notification API.
 *
 * isConfigured() always returns true (mirrors macOS UNUserNotificationCenter
 * which is always available as fallback).
 */

export type NotificationListener = (event: BrowserNotificationEvent) => void;

export interface BrowserNotificationEvent {
  title: string;
  message: string;
  cardId: string | null;
  timestamp: string; // ISO8601
}

export class BrowserNotificationClient implements NotifierPort {
  private readonly listeners: Set<NotificationListener> = new Set();

  async sendNotification(
    title: string,
    message: string,
    _imageData: Buffer | null,
    cardId: string | null,
  ): Promise<void> {
    const event: BrowserNotificationEvent = {
      title,
      message,
      cardId,
      timestamp: new Date().toISOString(),
    };

    info('notify', `Browser notification: ${title}`);

    // Emit to all SSE listeners (browser clients)
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors should not break notification delivery
      }
    }
  }

  isConfigured(): boolean {
    return true; // Always available -- browser Notification API fallback
  }

  /** Register an SSE listener for notification events. Returns unsubscribe function. */
  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Current number of active listeners. */
  get listenerCount(): number {
    return this.listeners.size;
  }
}
