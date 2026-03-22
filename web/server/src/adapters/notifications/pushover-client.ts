import FormData from 'form-data';
import { info } from '../../infrastructure/logger.js';
import type { NotifierPort } from '../../domain/ports/notifier.js';

/**
 * Sends push notifications via the Pushover API.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Notifications/PushoverClient.swift
 * Spec: Section 7.6 (Notifications)
 *
 * POST https://api.pushover.net/1/messages.json with multipart form-data:
 * token, user, title, message, html=1, url (kanbancode://card/<cardId>),
 * url_title, attachment (image.png).
 */

export class PushoverClient implements NotifierPort {
  private readonly token: string;
  private readonly userKey: string;
  private readonly apiURL: string;
  private readonly fetchFn: typeof fetch;

  constructor(
    token: string,
    userKey: string,
    options?: { apiURL?: string; fetchFn?: typeof fetch },
  ) {
    this.token = token;
    this.userKey = userKey;
    this.apiURL = options?.apiURL ?? 'https://api.pushover.net/1/messages.json';
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
  }

  async sendNotification(
    title: string,
    message: string,
    imageData: Buffer | null,
    cardId: string | null,
  ): Promise<void> {
    const form = new FormData();
    form.append('token', this.token);
    form.append('user', this.userKey);
    form.append('title', title);
    form.append('message', message);
    form.append('html', '1');

    if (cardId) {
      form.append('url', `kanbancode://card/${cardId}`);
      form.append('url_title', 'Open in Kanban Code');
    }

    if (imageData) {
      form.append('attachment', imageData, {
        filename: 'image.png',
        contentType: 'image/png',
      });
    }

    const response = await this.fetchFn(this.apiURL, {
      method: 'POST',
      body: form as unknown as BodyInit,
      headers: form.getHeaders(),
    });

    if (!response.ok) {
      throw new NotificationError('pushoverFailed');
    }

    info('notify', `Pushover notification sent: ${title}`);
  }

  isConfigured(): boolean {
    return this.token.length > 0 && this.userKey.length > 0;
  }
}

export class NotificationError extends Error {
  constructor(
    public readonly code: 'pushoverFailed' | 'browserNotificationFailed',
  ) {
    super(
      code === 'pushoverFailed'
        ? 'Pushover notification failed'
        : 'Browser notification failed',
    );
    this.name = 'NotificationError';
  }
}
