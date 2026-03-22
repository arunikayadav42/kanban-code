import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CoordinationStore } from '../coordination-store.js';
import { createLink } from '@kanban-code/shared';

describe('CoordinationStore', () => {
  let tempDir: string;
  let store: CoordinationStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-test-'));
    store = new CoordinationStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readLinks', () => {
    it('returns empty array when file does not exist', () => {
      expect(store.readLinks()).toEqual([]);
    });

    it('reads links from file', () => {
      const link = createLink({ id: 'card_test1', name: 'Test Card' });
      store.writeLinks([link]);
      const result = store.readLinks();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('card_test1');
      expect(result[0].name).toBe('Test Card');
    });

    it('recovers from corrupted JSON (creates .bkp)', () => {
      const filePath = path.join(tempDir, 'links.json');
      fs.writeFileSync(filePath, '{{invalid json!!}', 'utf-8');
      const result = store.readLinks();
      expect(result).toEqual([]);
      expect(fs.existsSync(filePath + '.bkp')).toBe(true);
    });
  });

  describe('writeLinks', () => {
    it('creates directory if needed', () => {
      const deepDir = path.join(tempDir, 'sub', 'dir');
      const deepStore = new CoordinationStore(deepDir);
      deepStore.writeLinks([]);
      expect(fs.existsSync(path.join(deepDir, 'links.json'))).toBe(true);
    });

    it('writes valid JSON', () => {
      const link = createLink({ id: 'card_w1' });
      store.writeLinks([link]);
      const raw = JSON.parse(fs.readFileSync(store.path, 'utf-8'));
      expect(raw.links).toHaveLength(1);
      expect(raw.links[0].id).toBe('card_w1');
    });

    it('atomic write (no .tmp file left behind)', () => {
      store.writeLinks([createLink({ id: 'card_a1' })]);
      expect(fs.existsSync(store.path + '.tmp')).toBe(false);
    });
  });

  describe('linkById', () => {
    it('finds link by id', () => {
      store.writeLinks([createLink({ id: 'card_find1', name: 'Find Me' })]);
      expect(store.linkById('card_find1')?.name).toBe('Find Me');
    });

    it('returns null if not found', () => {
      expect(store.linkById('nonexistent')).toBeNull();
    });
  });

  describe('linkForSession', () => {
    it('finds link by session ID', () => {
      store.writeLinks([createLink({
        id: 'card_s1',
        sessionLink: { sessionId: 'session-abc' },
      })]);
      expect(store.linkForSession('session-abc')?.id).toBe('card_s1');
    });

    it('returns null if no session match', () => {
      expect(store.linkForSession('nonexistent')).toBeNull();
    });
  });

  describe('upsertLink', () => {
    it('inserts new link', () => {
      store.upsertLink(createLink({ id: 'card_u1', name: 'New' }));
      expect(store.readLinks()).toHaveLength(1);
    });

    it('updates existing link by id', () => {
      store.writeLinks([createLink({ id: 'card_u2', name: 'Old' })]);
      store.upsertLink(createLink({ id: 'card_u2', name: 'Updated' }));
      const links = store.readLinks();
      expect(links).toHaveLength(1);
      expect(links[0].name).toBe('Updated');
    });
  });

  describe('updateLinkById', () => {
    it('updates specific fields and sets updatedAt', async () => {
      const original = createLink({ id: 'card_up1', name: 'Original', updatedAt: '2020-01-01T00:00:00.000Z' });
      store.writeLinks([original]);
      store.updateLinkById('card_up1', link => ({ ...link, name: 'Modified' }));
      const updated = store.linkById('card_up1')!;
      expect(updated.name).toBe('Modified');
      expect(updated.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    });

    it('does nothing if id not found', () => {
      store.writeLinks([createLink({ id: 'card_up2' })]);
      store.updateLinkById('nonexistent', link => ({ ...link, name: 'X' }));
      expect(store.readLinks()).toHaveLength(1);
    });
  });

  describe('removeLinkById', () => {
    it('removes link by id', () => {
      store.writeLinks([
        createLink({ id: 'card_r1' }),
        createLink({ id: 'card_r2' }),
      ]);
      store.removeLinkById('card_r1');
      const links = store.readLinks();
      expect(links).toHaveLength(1);
      expect(links[0].id).toBe('card_r2');
    });
  });

  describe('removeLinkBySessionId', () => {
    it('removes link by session ID', () => {
      store.writeLinks([
        createLink({ id: 'card_rs1', sessionLink: { sessionId: 'sess-1' } }),
        createLink({ id: 'card_rs2', sessionLink: { sessionId: 'sess-2' } }),
      ]);
      store.removeLinkBySessionId('sess-1');
      expect(store.readLinks()).toHaveLength(1);
    });
  });

  describe('modifyLinks', () => {
    it('atomically transforms all links', () => {
      store.writeLinks([
        createLink({ id: 'card_m1', name: 'A' }),
        createLink({ id: 'card_m2', name: 'B' }),
      ]);
      store.modifyLinks(links => links.map(l => ({ ...l, name: l.name + '!' })));
      const links = store.readLinks();
      expect(links[0].name).toBe('A!');
      expect(links[1].name).toBe('B!');
    });
  });

  describe('path', () => {
    it('returns the file path', () => {
      expect(store.path).toContain('links.json');
    });
  });
});
