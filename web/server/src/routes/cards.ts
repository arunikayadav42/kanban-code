import fs from 'fs';
import { Router } from 'express';
import type { StoreManager } from '../usecases/store-manager.js';
import type { LaunchSession } from '../usecases/launch-session.js';
import { createLink, getEffectiveAssistant, getDisplayTitle, validateColumnMove } from '@kanban-code/shared';
import type { CodingAssistantRegistry } from '../usecases/coding-assistant-registry.js';
import { generate } from '../infrastructure/ksuid.js';
import type { KanbanCodeColumn, QueuedPrompt } from '@kanban-code/shared';
import { info } from '../infrastructure/logger.js';

/**
 * Card CRUD REST endpoints.
 *
 * Spec: Section 3.3 (REST API — Card CRUD, Terminal Management, Link Management)
 */

export function createCardRoutes(store: StoreManager, launcher?: LaunchSession, registry?: CodingAssistantRegistry): Router {
  const router = Router();

  // POST /api/cards — Create manual task
  router.post('/', (req, res) => {
    const { name, promptBody, projectPath, assistant, column, startImmediately } = req.body;
    info('cards', `Create card: assistant=${assistant}, projectPath=${projectPath}, name=${name}`);
    const link = createLink({
      id: generate('card'),
      name: name || undefined,
      promptBody,
      projectPath,
      assistant,
      column: column ?? 'backlog',
      source: 'manual',
    });
    store.dispatch({ type: 'createManualTask', link }, { isUserAction: true });
    res.status(201).json(link);
  });

  // POST /api/cards/bulk-archive — Bulk archive cards
  router.post('/bulk-archive', (req, res) => {
    const { cardIds } = req.body;
    if (!Array.isArray(cardIds) || cardIds.length === 0) {
      res.status(400).json({ error: 'cardIds array required' });
      return;
    }
    const state = store.getState();
    const valid = cardIds.filter((id: string) => state.links[id]);
    const skipped = cardIds.filter((id: string) => !state.links[id]);
    store.dispatch({ type: 'bulkArchive', cardIds: valid }, { isUserAction: true });
    res.json({ succeeded: valid, skipped });
  });

  // POST /api/cards/bulk-resume — Bulk resume cards
  router.post('/bulk-resume', (req, res) => {
    const { cardIds } = req.body;
    if (!Array.isArray(cardIds) || cardIds.length === 0) {
      res.status(400).json({ error: 'cardIds array required' });
      return;
    }
    const state = store.getState();
    const eligible = cardIds.filter((id: string) => state.links[id]?.sessionLink);
    const skipped = cardIds.filter((id: string) => !state.links[id]?.sessionLink);
    if (eligible.length > 0) {
      store.dispatch({ type: 'bulkResume', cardIds: eligible }, { isUserAction: true });
    }
    // Launch sessions with concurrency cap of 5
    if (launcher && eligible.length > 0) {
      const postState = store.getState();
      const MAX_CONCURRENT = 5;
      const toLaunch = eligible
        .map((id: string) => {
          const link = postState.links[id];
          if (!link?.tmuxLink?.sessionName || !link?.sessionLink?.sessionId) return null;
          return {
            cardId: id,
            tmuxName: link.tmuxLink.sessionName,
            sessionId: link.sessionLink.sessionId,
            sessionPath: link.sessionLink.sessionPath,
            projectPath: link.projectPath ?? process.env.HOME ?? '/tmp',
            assistant: getEffectiveAssistant(link),
          };
        })
        .filter(Boolean) as Array<{ cardId: string; tmuxName: string; sessionId: string; sessionPath?: string; projectPath: string; assistant: string }>;

      // Fire-and-forget with concurrency cap
      (async () => {
        for (let i = 0; i < toLaunch.length; i += MAX_CONCURRENT) {
          const batch = toLaunch.slice(i, i + MAX_CONCURRENT);
          await Promise.allSettled(
            batch.map(card =>
              launcher.resume({
                sessionId: card.sessionId,
                projectPath: card.projectPath,
                assistant: card.assistant,
                skipPermissions: true,
              }).then(tmuxName => {
                if (card.sessionPath) {
                  try { const now = new Date(); fs.utimesSync(card.sessionPath, now, now); } catch { /* ignore */ }
                }
                store.dispatch({ type: 'resumeCompleted', cardId: card.cardId, tmuxName });
              }).catch(err => {
                store.dispatch({ type: 'resumeFailed', cardId: card.cardId, error: String(err) });
              })
            )
          );
        }
      })();
    }
    res.json({ succeeded: eligible, skipped });
  });

  // POST /api/cards/bulk-move-project — Bulk move cards to project
  router.post('/bulk-move-project', (req, res) => {
    const { cardIds, projectPath } = req.body;
    if (!Array.isArray(cardIds) || cardIds.length === 0 || !projectPath) {
      res.status(400).json({ error: 'cardIds array and projectPath required' });
      return;
    }
    const state = store.getState();
    const valid = cardIds.filter((id: string) => state.links[id]);
    const skipped = cardIds.filter((id: string) => !state.links[id]);
    store.dispatch({ type: 'bulkMoveToProject', cardIds: valid, projectPath }, { isUserAction: true });
    res.json({ succeeded: valid, skipped });
  });

  // POST /api/cards/bulk-delete — Bulk delete cards (permanent, irreversible)
  router.post('/bulk-delete', (req, res) => {
    const { cardIds } = req.body;
    if (!Array.isArray(cardIds) || cardIds.length === 0) {
      res.status(400).json({ error: 'cardIds array required' });
      return;
    }
    const state = store.getState();
    const valid = cardIds.filter((id: string) => state.links[id]);
    const skipped = cardIds.filter((id: string) => !state.links[id]);
    store.dispatch({ type: 'bulkDelete', cardIds: valid }, { isUserAction: true });
    res.json({ succeeded: valid, skipped });
  });

  // GET /api/cards — List cards (with optional column filter)
  router.get('/', (req, res) => {
    const state = store.getState();
    const column = req.query.column as string | undefined;
    const offset = parseInt(req.query.offset as string ?? '0', 10);
    const limit = parseInt(req.query.limit as string ?? '100', 10);

    let cards = Object.values(state.links);
    if (column) {
      cards = cards.filter(c => c.column === column);
    }

    // Sort by sortOrder then updatedAt
    cards.sort((a, b) => {
      const aOrder = a.sortOrder ?? 999999;
      const bOrder = b.sortOrder ?? 999999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    });

    const total = cards.length;
    const paginated = cards.slice(offset, offset + limit);
    res.json({ cards: paginated, total, offset, limit });
  });

  // PATCH /api/cards/:id — Update card (rename, move, updatePrompt)
  router.patch('/:id', (req, res) => {
    const { id } = req.params;
    const state = store.getState();
    if (!state.links[id]) {
      res.status(404).json({ error: 'Card not found' });
      return;
    }

    const { name, column, promptBody, promptImagePaths } = req.body;

    if (name !== undefined) {
      store.dispatch({ type: 'renameCard', cardId: id, name }, { isUserAction: true });
    }
    if (column !== undefined) {
      const card = store.getState().links[id];
      const rejection = validateColumnMove(card, column as KanbanCodeColumn);
      if (rejection) { res.status(422).json({ error: rejection }); return; }
      store.dispatch({ type: 'moveCard', cardId: id, column: column as KanbanCodeColumn }, { isUserAction: true });
    }
    // promptBody update will be added when updatePrompt action is in full Reducer

    res.json(store.getState().links[id]);
  });

  // DELETE /api/cards/:id — Delete card
  router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const state = store.getState();
    if (!state.links[id]) {
      res.status(404).json({ error: 'Card not found' });
      return;
    }
    store.dispatch({ type: 'deleteCard', cardId: id }, { isUserAction: true });
    res.status(204).send();
  });

  // POST /api/cards/:id/archive — Archive card
  router.post('/:id/archive', (req, res) => {
    const { id } = req.params;
    store.dispatch({ type: 'archiveCard', cardId: id }, { isUserAction: true });
    res.json(store.getState().links[id] ?? { archived: true });
  });

  // POST /api/cards/:id/reorder — Reorder within column
  router.post('/:id/reorder', (req, res) => {
    const { id } = req.params;
    const { targetCardId, above } = req.body;
    store.dispatch({ type: 'reorderCard', cardId: id, targetCardId, above }, { isUserAction: true });
    res.json({ ok: true });
  });

  // POST /api/cards/:id/launch — Launch session
  router.post('/:id/launch', (req, res) => {
    const { id } = req.params;
    const { prompt, projectPath, worktreeName, runRemotely, commandOverride, skipPermissions } = req.body;
    store.dispatch({
      type: 'launchCard',
      cardId: id,
      prompt,
      projectPath,
      worktreeName,
      runRemotely,
      commandOverride,
      skipPermissions,
    }, { isUserAction: true });

    const link = store.getState().links[id];
    if (launcher && link?.tmuxLink?.sessionName) {
      launcher.launch({
        sessionName: link.tmuxLink.sessionName,
        projectPath,
        prompt,
        worktreeName,
        skipPermissions,
        assistant: getEffectiveAssistant(link),
      }).then((tmuxName) => {
        store.dispatch({ type: 'launchCompleted', cardId: id, tmuxName });
      }).catch((err) => {
        store.dispatch({ type: 'launchFailed', cardId: id, error: String(err) });
      });
    }
    res.json(link);
  });

  // POST /api/cards/:id/resume — Resume session
  router.post('/:id/resume', (req, res) => {
    const { id } = req.params;
    store.dispatch({ type: 'resumeCard', cardId: id }, { isUserAction: true });

    const link = store.getState().links[id];
    if (launcher && link?.tmuxLink?.sessionName && link?.sessionLink?.sessionId) {
      const projectPath = link.projectPath ?? process.env.HOME ?? '/tmp';
      launcher.resume({
        sessionId: link.sessionLink.sessionId,
        projectPath,
        assistant: getEffectiveAssistant(link),
        skipPermissions: true,
      }).then((tmuxName) => {
        // Touch the session JSONL so the activity detector sees it as recently modified
        // (idle_waiting) rather than stale/ended. Without this, the reconciler would
        // immediately demote the card back to requires_attention.
        if (link.sessionLink?.sessionPath) {
          try {
            const now = new Date();
            fs.utimesSync(link.sessionLink.sessionPath, now, now);
          } catch { /* file may not exist yet */ }
        }
        store.dispatch({ type: 'resumeCompleted', cardId: id, tmuxName });
      }).catch((err) => {
        store.dispatch({ type: 'resumeFailed', cardId: id, error: String(err) });
      });
    }
    res.json(store.getState().links[id]);
  });

  // POST /api/cards/:id/cancel-launch — Cancel in-progress launch
  router.post('/:id/cancel-launch', (req, res) => {
    const { id } = req.params;
    store.dispatch({ type: 'cancelLaunch', cardId: id }, { isUserAction: true });
    res.json(store.getState().links[id]);
  });

  // DELETE /api/cards/:id/terminals/:name — Kill terminal
  router.delete('/:id/terminals/:name', (req, res) => {
    const { id, name } = req.params;
    store.dispatch({ type: 'killTerminal', cardId: id, sessionName: name }, { isUserAction: true });
    res.json(store.getState().links[id] ?? { ok: true });
  });

  // POST /api/cards/:id/move-to-project — Move card to different project
  router.post('/:id/move-to-project', (req, res) => {
    const { id } = req.params;
    const { projectPath } = req.body;
    if (!projectPath) {
      res.status(400).json({ error: 'projectPath required' });
      return;
    }
    const state = store.getState();
    if (!state.links[id]) {
      res.status(404).json({ error: 'Card not found' });
      return;
    }
    store.dispatch({ type: 'moveCardToProject', cardId: id, projectPath }, { isUserAction: true });
    res.json(store.getState().links[id]);
  });

  // --- Queued Prompts ---

  // POST /api/cards/:id/queued-prompts — Add a queued prompt
  router.post('/:id/queued-prompts', (req, res) => {
    const { id } = req.params;
    const state = store.getState();
    if (!state.links[id]) { res.status(404).json({ error: 'Card not found' }); return; }
    const { body, sendAutomatically, imagePaths } = req.body;
    if (!body || typeof body !== 'string') { res.status(400).json({ error: 'body is required' }); return; }
    const prompt: QueuedPrompt = {
      id: generate('qp'),
      body: body.trim(),
      sendAutomatically: sendAutomatically ?? false,
      imagePaths: imagePaths ?? null,
    };
    store.dispatch({ type: 'addQueuedPrompt', cardId: id, prompt }, { isUserAction: true });
    res.status(201).json(prompt);
  });

  // DELETE /api/cards/:id/queued-prompts/:pid — Remove a queued prompt
  router.delete('/:id/queued-prompts/:pid', (req, res) => {
    const { id, pid } = req.params;
    const state = store.getState();
    if (!state.links[id]) { res.status(404).json({ error: 'Card not found' }); return; }
    store.dispatch({ type: 'removeQueuedPrompt', cardId: id, promptId: pid }, { isUserAction: true });
    res.json(store.getState().links[id]);
  });

  // POST /api/cards/:id/queued-prompts/:pid/send — Send a specific queued prompt
  router.post('/:id/queued-prompts/:pid/send', (req, res) => {
    const { id, pid } = req.params;
    const state = store.getState();
    const card = state.links[id];
    if (!card) { res.status(404).json({ error: 'Card not found' }); return; }
    if (!card.queuedPrompts?.some(p => p.id === pid)) { res.status(404).json({ error: 'Prompt not found' }); return; }
    store.dispatch({ type: 'sendQueuedPrompt', cardId: id, promptId: pid }, { isUserAction: true });
    res.json(store.getState().links[id]);
  });

  // PATCH /api/cards/:id/queued-prompts/:pid — Update a queued prompt
  router.patch('/:id/queued-prompts/:pid', (req, res) => {
    const { id, pid } = req.params;
    const state = store.getState();
    if (!state.links[id]) { res.status(404).json({ error: 'Card not found' }); return; }
    const { body, sendAutomatically } = req.body;
    store.dispatch({ type: 'updateQueuedPrompt', cardId: id, promptId: pid, body, sendAutomatically }, { isUserAction: true });
    res.json(store.getState().links[id]);
  });

  // POST /api/cards/:id/fork — Fork a session into a new card
  router.post('/:id/fork', async (req, res) => {
    try {
      const { id } = req.params;
      const state = store.getState();
      const card = state.links[id];
      if (!card) { res.status(404).json({ error: 'Card not found' }); return; }
      const assistant = getEffectiveAssistant(card);
      const sessionStore = registry?.store(assistant);
      if (!sessionStore || !card.sessionLink?.sessionPath) {
        res.status(400).json({ error: 'No session to fork' }); return;
      }
      const newSessionId = await sessionStore.forkSession(card.sessionLink.sessionPath);
      const newSessionPath = sessionStore.resolveSessionPath(newSessionId, card.sessionLink.sessionPath);
      const newCard = createLink({
        id: generate('card'),
        name: `Fork of ${getDisplayTitle(card)}`,
        projectPath: card.projectPath,
        assistant: card.assistant,
        column: card.column,
        sessionLink: { sessionId: newSessionId, sessionPath: newSessionPath },
        source: 'manual' as const,
      });
      store.dispatch({ type: 'createManualTask', link: newCard }, { isUserAction: true });
      res.status(201).json(newCard);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/cards/:id/send-prompt — Send a direct prompt to a running session
  router.post('/:id/send-prompt', (req, res) => {
    const { id } = req.params;
    const state = store.getState();
    const card = state.links[id];
    if (!card) { res.status(404).json({ error: 'Card not found' }); return; }
    if (!card.tmuxLink) { res.status(400).json({ error: 'No running session' }); return; }
    const { body, imagePaths } = req.body;
    if (!body || typeof body !== 'string') { res.status(400).json({ error: 'body is required' }); return; }
    store.dispatch({ type: 'sendDirectPrompt', cardId: id, body: body.trim(), imagePaths }, { isUserAction: true });
    res.json({ sent: true });
  });

  // GET /api/cards/:id/history — Fetch session transcript turns
  router.get('/:id/history', async (req, res) => {
    const { id } = req.params;
    const link = store.getState().links[id];
    if (!link?.sessionLink?.sessionPath) {
      res.json({ turns: [], totalLineCount: 0, hasMore: false });
      return;
    }
    try {
      const assistant = getEffectiveAssistant(link);
      const sessionStore = registry?.store(assistant);
      if (sessionStore) {
        const turns = await sessionStore.readTranscript(link.sessionLink.sessionPath);
        res.json({ turns, totalLineCount: turns.length, hasMore: false });
      } else {
        res.json({ turns: [], totalLineCount: 0, hasMore: false });
      }
    } catch (err) {
      info('cards', `Failed to read history for ${id}: ${err}`);
      res.json({ turns: [], totalLineCount: 0, hasMore: false });
    }
  });

  return router;
}
