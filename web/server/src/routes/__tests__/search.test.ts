import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { StoreManager } from '../../usecases/store-manager.js';
import { EffectHandler } from '../../usecases/effect-handler.js';
import { CoordinationStore } from '../../infrastructure/coordination-store.js';
import { createSearchRoutes } from '../search.js';
import type { SessionStore, SearchResult } from '../../domain/ports/session-store.js';
import type { ConversationTurn } from '@kanban-code/shared';

/** Minimal mock SessionStore that records calls. */
function createMockSessionStore(
  searchResults?: SearchResult[][],
): SessionStore & { searchCalls: Array<{ query: string; paths: string[] }> } {
  const searchCalls: Array<{ query: string; paths: string[] }> = [];
  let callIndex = 0;

  return {
    searchCalls,
    async readTranscript(): Promise<ConversationTurn[]> {
      return [];
    },
    async forkSession(): Promise<string> {
      return 'fake-session-id';
    },
    async truncateSession(): Promise<void> {},
    async writeSession(): Promise<string> {
      return '/tmp/fake.jsonl';
    },
    async searchSessions(query: string, paths: string[]): Promise<SearchResult[]> {
      searchCalls.push({ query, paths });
      return searchResults?.[0] ?? [];
    },
    async searchSessionsStreaming(
      query: string,
      paths: string[],
      onResult: (results: SearchResult[]) => void,
    ): Promise<void> {
      searchCalls.push({ query, paths });
      if (searchResults) {
        for (const batch of searchResults) {
          onResult(batch);
        }
      }
    },
    resolveSessionPath(_sessionId: string, originalPath: string): string {
      return originalPath;
    },
  };
}

describe('Search Routes', () => {
  let app: express.Express;
  let store: StoreManager;
  let tempDir: string;

  function setup(
    searchResults?: SearchResult[][],
    seedLinks?: Record<string, any>,
  ) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-search-'));
    const coordStore = new CoordinationStore(tempDir);
    const effectHandler = new EffectHandler(coordStore);
    store = new StoreManager(effectHandler);

    if (seedLinks) {
      store.dispatch({ type: 'reconciled', result: { links: seedLinks } });
    }

    const sessionStore = createMockSessionStore(searchResults);

    app = express();
    app.use(express.json());
    app.use('/api/search', createSearchRoutes(store, sessionStore));

    return { sessionStore };
  }

  describe('GET /api/search', () => {
    it('returns 400 when query parameter is missing', async () => {
      setup();
      const res = await request(app).get('/api/search');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required query parameter/);
    });

    it('returns 400 when query is empty', async () => {
      setup();
      const res = await request(app).get('/api/search?q=');
      expect(res.status).toBe(400);
    });

    it('returns 400 when query is whitespace only', async () => {
      setup();
      const res = await request(app).get('/api/search?q=%20%20');
      expect(res.status).toBe(400);
    });

    it('returns empty response when no cards have session paths', async () => {
      setup();
      const res = await request(app).get('/api/search?q=test');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/x-ndjson/);
      expect(res.text).toBe('');
    });

    it('streams NDJSON results for matching sessions', async () => {
      const searchResults: SearchResult[][] = [
        [
          { sessionPath: '/sessions/abc.jsonl', score: 2.5, snippets: ['match one'] },
          { sessionPath: '/sessions/def.jsonl', score: 1.8, snippets: ['match two'] },
        ],
      ];

      const seedLinks = {
        card_1: {
          id: 'card_1',
          name: 'Test Card',
          column: 'in_progress',
          source: 'manual',
          sessionLink: { sessionId: 'abc', sessionPath: '/sessions/abc.jsonl' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        card_2: {
          id: 'card_2',
          name: 'Another Card',
          column: 'done',
          source: 'manual',
          sessionLink: { sessionId: 'def', sessionPath: '/sessions/def.jsonl' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const { sessionStore } = setup(searchResults, seedLinks);

      const res = await request(app).get('/api/search?q=auth');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/x-ndjson/);

      // Parse NDJSON lines
      const lines = res.text.trim().split('\n').filter(Boolean);
      expect(lines.length).toBe(2);

      const first = JSON.parse(lines[0]);
      expect(first.sessionPath).toBe('/sessions/abc.jsonl');
      expect(first.score).toBe(2.5);
      expect(first.snippets).toEqual(['match one']);
      expect(first.cardId).toBe('card_1');

      const second = JSON.parse(lines[1]);
      expect(second.sessionPath).toBe('/sessions/def.jsonl');
      expect(second.cardId).toBe('card_2');

      // Verify query was passed to session store
      expect(sessionStore.searchCalls).toHaveLength(1);
      expect(sessionStore.searchCalls[0].query).toBe('auth');
    });

    it('streams multiple batches as progressive NDJSON', async () => {
      const batch1: SearchResult[] = [
        { sessionPath: '/sessions/a.jsonl', score: 3.0, snippets: ['first batch'] },
      ];
      const batch2: SearchResult[] = [
        { sessionPath: '/sessions/a.jsonl', score: 3.0, snippets: ['first batch'] },
        { sessionPath: '/sessions/b.jsonl', score: 2.0, snippets: ['second batch'] },
      ];

      const seedLinks = {
        card_a: {
          id: 'card_a',
          name: 'A',
          column: 'in_progress',
          source: 'session',
          sessionLink: { sessionId: 'a', sessionPath: '/sessions/a.jsonl' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        card_b: {
          id: 'card_b',
          name: 'B',
          column: 'done',
          source: 'session',
          sessionLink: { sessionId: 'b', sessionPath: '/sessions/b.jsonl' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      setup([batch1, batch2], seedLinks);

      const res = await request(app).get('/api/search?q=test');
      const lines = res.text.trim().split('\n').filter(Boolean);

      // batch1 emits 1 line, batch2 emits 2 lines = 3 total NDJSON lines
      expect(lines.length).toBe(3);

      // Each line is valid JSON
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty('sessionPath');
        expect(parsed).toHaveProperty('score');
        expect(parsed).toHaveProperty('snippets');
      }
    });

    it('returns null cardId when session path does not match any card', async () => {
      const searchResults: SearchResult[][] = [
        [{ sessionPath: '/orphan/session.jsonl', score: 1.0, snippets: ['found'] }],
      ];

      const seedLinks = {
        card_x: {
          id: 'card_x',
          name: 'X',
          column: 'in_progress',
          source: 'session',
          sessionLink: { sessionId: 'x', sessionPath: '/sessions/x.jsonl' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      setup(searchResults, seedLinks);

      const res = await request(app).get('/api/search?q=test');
      const lines = res.text.trim().split('\n').filter(Boolean);
      expect(lines.length).toBe(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.cardId).toBeNull();
    });
  });
});
