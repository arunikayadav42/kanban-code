import type { NotifierPort } from '../../domain/ports/notifier.js';
import { BrowserNotificationClient } from './browser-notification-client.js';

/**
 * Tries a primary notifier (e.g. Pushover), falls back to a secondary
 * (e.g. browser notifications).
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Notifications/CompositeNotifier.swift
 * Spec: Section 7.6 (Notification Chain)
 *
 * Key behaviors:
 * - If primary is configured, try it first.
 * - If primary fails or is unconfigured, fall through to fallback.
 * - Fallback doesn't support images -- sends text only.
 * - updatePrimary allows hot-swap when settings change.
 * - isConfigured always returns true (fallback is always available).
 */
export class CompositeNotifier implements NotifierPort {
  private primary: NotifierPort | null;
  private readonly fallback: NotifierPort;

  constructor(
    primary: NotifierPort | null = null,
    fallback: NotifierPort = new BrowserNotificationClient(),
  ) {
    this.primary = primary;
    this.fallback = fallback;
  }

  async sendNotification(
    title: string,
    message: string,
    imageData: Buffer | null,
    cardId: string | null,
  ): Promise<void> {
    if (this.primary && this.primary.isConfigured()) {
      try {
        await this.primary.sendNotification(title, message, imageData, cardId);
        return;
      } catch {
        // Fall through to fallback
      }
    }

    // Fallback doesn't support images, send text only
    await this.fallback.sendNotification(title, message, null, cardId);
  }

  isConfigured(): boolean {
    return true; // Always configured -- fallback is always available
  }

  /** Hot-swap the primary notifier (e.g. when settings change). */
  updatePrimary(notifier: NotifierPort | null): void {
    this.primary = notifier;
  }
}
