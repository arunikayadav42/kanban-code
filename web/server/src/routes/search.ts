import { Router } from 'express';
import type { SessionStore } from '../domain/ports/session-store.js';
import type { StoreManager } from '../usecases/store-manager.js';

/**
 * Search API routes.
 *
 * Spec: Section 3.4 (Search API)
 *
 * GET /api/search?q=QUERY
 *   Streams NDJSON results (one JSON object per line) using BM25 scoring
 *   via ClaudeCodeSessionStore.searchSessionsStreaming.
 *   Content-Type: application/x-ndjson
 */

export function createSearchRoutes(
  store: StoreManager,
  sessionStore: SessionStore,
): Router {
  const router = Router();

  // GET /api/search?q=QUERY — NDJSON streaming search
  router.get('/', async (req, res) => {
    const query = (req.query.q as string | undefined) ?? '';
    if (!query.trim()) {
      res.status(400).json({ error: 'Missing required query parameter: q' });
      return;
    }

    // Collect session paths from current cards
    const state = store.getState();
    const paths: string[] = [];
    for (const link of Object.values(state.links)) {
      const sessionPath = link.sessionLink?.sessionPath;
      if (sessionPath) {
        paths.push(sessionPath);
      }
    }

    if (paths.length === 0) {
      res.status(200).setHeader('Content-Type', 'application/x-ndjson');
      res.end();
      return;
    }

    // Set up NDJSON streaming response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
      await sessionStore.searchSessionsStreaming(query, paths, (results) => {
        // Each callback invocation writes the updated ranked results as one NDJSON line
        for (const result of results) {
          const line = JSON.stringify({
            sessionPath: result.sessionPath,
            score: result.score,
            snippets: result.snippets,
            // Attach card id if we can find one
            cardId: findCardIdForPath(state.links, result.sessionPath),
          });
          res.write(line + '\n');
        }
      });
    } catch (err) {
      // If headers already sent, we can only abort the stream
      if (!res.headersSent) {
        res.status(500).json({ error: 'Search failed' });
        return;
      }
    }

    res.end();
  });

  return router;
}

/**
 * Find the card ID whose sessionLink.sessionPath matches the given path.
 */
function findCardIdForPath(
  links: Record<string, { id: string; sessionLink?: { sessionPath?: string | null } | null }>,
  sessionPath: string,
): string | null {
  for (const link of Object.values(links)) {
    if (link.sessionLink?.sessionPath === sessionPath) {
      return link.id;
    }
  }
  return null;
}
