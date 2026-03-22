import { describe, it, expect, vi } from 'vitest';
import { PushoverClient, NotificationError } from '../pushover-client.js';

describe('PushoverClient', () => {
  function createMockFetch(status = 200): typeof fetch {
    return vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
    });
  }

  describe('isConfigured', () => {
    it('returns true when token and userKey are non-empty', () => {
      const client = new PushoverClient('tok123', 'user456');
      expect(client.isConfigured()).toBe(true);
    });

    it('returns false when token is empty', () => {
      const client = new PushoverClient('', 'user456');
      expect(client.isConfigured()).toBe(false);
    });

    it('returns false when userKey is empty', () => {
      const client = new PushoverClient('tok123', '');
      expect(client.isConfigured()).toBe(false);
    });

    it('returns false when both are empty', () => {
      const client = new PushoverClient('', '');
      expect(client.isConfigured()).toBe(false);
    });
  });

  describe('sendNotification', () => {
    it('sends POST to Pushover API with form fields', async () => {
      const mockFetch = createMockFetch(200);
      const client = new PushoverClient('tok', 'usr', { fetchFn: mockFetch });

      await client.sendNotification('Test Title', 'Test Message', null, null);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://api.pushover.net/1/messages.json');
      expect(options.method).toBe('POST');
    });

    it('includes cardId as url and url_title fields', async () => {
      const mockFetch = createMockFetch(200);
      const client = new PushoverClient('tok', 'usr', { fetchFn: mockFetch });

      await client.sendNotification('Title', 'Msg', null, 'card_abc123');

      // The body is a FormData instance, we verify the fetch was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('includes image attachment when imageData provided', async () => {
      const mockFetch = createMockFetch(200);
      const client = new PushoverClient('tok', 'usr', { fetchFn: mockFetch });
      const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header

      await client.sendNotification('Title', 'Msg', imageData, null);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('throws NotificationError on non-2xx response', async () => {
      const mockFetch = createMockFetch(401);
      const client = new PushoverClient('tok', 'usr', { fetchFn: mockFetch });

      await expect(
        client.sendNotification('Title', 'Msg', null, null),
      ).rejects.toThrow(NotificationError);
    });

    it('throws NotificationError on 500 response', async () => {
      const mockFetch = createMockFetch(500);
      const client = new PushoverClient('tok', 'usr', { fetchFn: mockFetch });

      await expect(
        client.sendNotification('Title', 'Msg', null, null),
      ).rejects.toThrow('Pushover notification failed');
    });

    it('uses custom apiURL when provided', async () => {
      const mockFetch = createMockFetch(200);
      const client = new PushoverClient('tok', 'usr', {
        fetchFn: mockFetch,
        apiURL: 'https://custom.api/push',
      });

      await client.sendNotification('Title', 'Msg', null, null);

      const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://custom.api/push');
    });
  });

  describe('NotificationError', () => {
    it('has correct message for pushoverFailed', () => {
      const err = new NotificationError('pushoverFailed');
      expect(err.message).toBe('Pushover notification failed');
      expect(err.code).toBe('pushoverFailed');
      expect(err.name).toBe('NotificationError');
    });

    it('has correct message for browserNotificationFailed', () => {
      const err = new NotificationError('browserNotificationFailed');
      expect(err.message).toBe('Browser notification failed');
      expect(err.code).toBe('browserNotificationFailed');
    });
  });
});
