import { describe, it, expect, vi } from 'vitest';
import { BrowserNotificationClient } from '../browser-notification-client.js';
import type { BrowserNotificationEvent } from '../browser-notification-client.js';

describe('BrowserNotificationClient', () => {
  describe('isConfigured', () => {
    it('always returns true', () => {
      const client = new BrowserNotificationClient();
      expect(client.isConfigured()).toBe(true);
    });
  });

  describe('sendNotification', () => {
    it('emits event to all subscribed listeners', async () => {
      const client = new BrowserNotificationClient();
      const received: BrowserNotificationEvent[] = [];
      client.subscribe((e) => received.push(e));

      await client.sendNotification('Title', 'Body', null, 'card_123');

      expect(received).toHaveLength(1);
      expect(received[0].title).toBe('Title');
      expect(received[0].message).toBe('Body');
      expect(received[0].cardId).toBe('card_123');
      expect(received[0].timestamp).toBeTruthy();
    });

    it('emits to multiple listeners', async () => {
      const client = new BrowserNotificationClient();
      const events1: BrowserNotificationEvent[] = [];
      const events2: BrowserNotificationEvent[] = [];
      client.subscribe((e) => events1.push(e));
      client.subscribe((e) => events2.push(e));

      await client.sendNotification('T', 'M', null, null);

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
    });

    it('works with no listeners (no error)', async () => {
      const client = new BrowserNotificationClient();
      await expect(
        client.sendNotification('T', 'M', null, null),
      ).resolves.toBeUndefined();
    });

    it('ignores imageData (not supported server-side)', async () => {
      const client = new BrowserNotificationClient();
      const events: BrowserNotificationEvent[] = [];
      client.subscribe((e) => events.push(e));
      const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

      await client.sendNotification('T', 'M', imageData, null);

      expect(events).toHaveLength(1);
      // BrowserNotificationEvent doesn't include imageData
      expect(events[0].title).toBe('T');
    });

    it('does not throw if a listener throws', async () => {
      const client = new BrowserNotificationClient();
      client.subscribe(() => { throw new Error('listener broke'); });
      const good: BrowserNotificationEvent[] = [];
      client.subscribe((e) => good.push(e));

      await expect(
        client.sendNotification('T', 'M', null, null),
      ).resolves.toBeUndefined();
      expect(good).toHaveLength(1);
    });

    it('includes cardId as null when not provided', async () => {
      const client = new BrowserNotificationClient();
      const events: BrowserNotificationEvent[] = [];
      client.subscribe((e) => events.push(e));

      await client.sendNotification('T', 'M', null, null);

      expect(events[0].cardId).toBeNull();
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('returns unsubscribe function', async () => {
      const client = new BrowserNotificationClient();
      const events: BrowserNotificationEvent[] = [];
      const unsub = client.subscribe((e) => events.push(e));

      await client.sendNotification('T1', 'M1', null, null);
      expect(events).toHaveLength(1);

      unsub();
      await client.sendNotification('T2', 'M2', null, null);
      expect(events).toHaveLength(1); // No new event after unsub
    });

    it('tracks listener count', () => {
      const client = new BrowserNotificationClient();
      expect(client.listenerCount).toBe(0);

      const unsub1 = client.subscribe(() => {});
      expect(client.listenerCount).toBe(1);

      const unsub2 = client.subscribe(() => {});
      expect(client.listenerCount).toBe(2);

      unsub1();
      expect(client.listenerCount).toBe(1);

      unsub2();
      expect(client.listenerCount).toBe(0);
    });
  });
});
