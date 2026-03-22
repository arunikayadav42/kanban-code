# API Separation Design Spec

**Date:** 2026-03-15
**Goal:** Fix broken features + make backend consumable by React Native mobile app

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Mobile platform | React Native (shares `@kanban-code/shared`) | Reuse Zustand store, types, helpers |
| State model | Keep full-state push, add server-computed fields | Small dataset (tens-hundreds of cards), shared filtering code |
| Queued prompt routes | 4 dedicated REST endpoints | Clean REST, each maps to existing reducer action |
| SSE type strictness | Add missing payload interfaces, keep loose wrapper | Gradual migration, less disruptive |
| Drop validation | Server-only with hold-and-spinner | Single source of truth, acceptable UX |
| Image handling | Keep base64-in-payload | Small images, controlled access, defer upload endpoint |
| Missing endpoints | Add all: /api/state, /api/assistants, fork, send-prompt | Complete coverage for mobile |

## Conventions

### Error Response Contract
All API errors use a consistent envelope:
```ts
{ error: string }
```
HTTP status codes: 400 (bad request), 404 (not found), 422 (validation rejection), 500 (server error). Existing routes already use this pattern. New routes must follow it.

### Authentication
All routes under `/api` inherit the global `authMiddleware` (applied via `app.use('/api', authMiddleware)` in index.ts). No per-route auth configuration needed for new endpoints.

### Mobile SSE Strategy
React Native does not have native `EventSource`. Mobile clients use `react-native-sse` polyfill (or equivalent). The server's SSE endpoint (`/api/events`) sends an `id:` field with each event via `state-broadcaster.ts`. Mobile clients should pass `Last-Event-ID` on reconnect. Additionally, `GET /api/state` (Slice 4) provides a REST fallback for foreground resume without re-establishing SSE.

### Visual Feedback Pattern (Cross-Cutting)

Every async operation provides immediate visual feedback via a shared `pendingOps` pattern in the Zustand store:

```ts
// store/index.ts additions
interface PendingOperation {
  cardId: string;
  type: 'fork' | 'move' | 'addPrompt' | 'sendPrompt' | 'removePrompt' | 'sendDirect';
  label: string;  // "Forking session..." / "Moving to In Review..."
}

// State additions
pendingOps: Record<string, PendingOperation>;  // keyed by cardId

// Actions
setPendingOp(cardId: string, op: PendingOperation): void;
clearPendingOp(cardId: string): void;
```

**CardView rendering:** When `pendingOps[link.id]` exists, the card renders a semi-transparent dark overlay with the orbital dot spinner and the operation label below it. The card is NOT disabled — user can still click to view details.

**Spinner CSS** — orbital multi-shadow dot spinner (add to client styles):
```css
.card-pending-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  z-index: 10;
}
.card-pending-overlay .loader {
  font-size: 10px;
  width: 1em;
  height: 1em;
  border-radius: 50%;
  position: relative;
  text-indent: -9999em;
  animation: mulShdSpin 1.1s infinite ease;
  transform: translateZ(0);
}
.card-pending-overlay .label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 500;
}
@keyframes mulShdSpin {
  0%, 100% {
    box-shadow: 0em -2.6em 0em 0em #ffffff,
      1.8em -1.8em 0 0em rgba(255,255,255, 0.2),
      2.5em 0em 0 0em rgba(255,255,255, 0.2),
      1.75em 1.75em 0 0em rgba(255,255,255, 0.2),
      0em 2.5em 0 0em rgba(255,255,255, 0.2),
      -1.8em 1.8em 0 0em rgba(255,255,255, 0.2),
      -2.6em 0em 0 0em rgba(255,255,255, 0.5),
      -1.8em -1.8em 0 0em rgba(255,255,255, 0.7);
  }
  12.5% {
    box-shadow: 0em -2.6em 0em 0em rgba(255,255,255, 0.7),
      1.8em -1.8em 0 0em #ffffff,
      2.5em 0em 0 0em rgba(255,255,255, 0.2),
      1.75em 1.75em 0 0em rgba(255,255,255, 0.2),
      0em 2.5em 0 0em rgba(255,255,255, 0.2),
      -1.8em 1.8em 0 0em rgba(255,255,255, 0.2),
      -2.6em 0em 0 0em rgba(255,255,255, 0.2),
      -1.8em -1.8em 0 0em rgba(255,255,255, 0.5);
  }
  25% {
    box-shadow: 0em -2.6em 0em 0em rgba(255,255,255, 0.5),
      1.8em -1.8em 0 0em rgba(255,255,255, 0.7),
      2.5em 0em 0 0em #ffffff,
      1.75em 1.75em 0 0em rgba(255,255,255, 0.2),
      0em 2.5em 0 0em rgba(255,255,255, 0.2),
      -1.8em 1.8em 0 0em rgba(255,255,255, 0.2),
      -2.6em 0em 0 0em rgba(255,255,255, 0.2),
      -1.8em -1.8em 0 0em rgba(255,255,255, 0.2);
  }
  37.5% {
    box-shadow: 0em -2.6em 0em 0em rgba(255,255,255, 0.2),
      1.8em -1.8em 0 0em rgba(255,255,255, 0.5),
      2.5em 0em 0 0em rgba(255,255,255, 0.7),
      1.75em 1.75em 0 0em #ffffff,
      0em 2.5em 0 0em rgba(255,255,255, 0.2),
      -1.8em 1.8em 0 0em rgba(255,255,255, 0.2),
      -2.6em 0em 0 0em rgba(255,255,255, 0.2),
      -1.8em -1.8em 0 0em rgba(255,255,255, 0.2);
  }
  50% {
    box-shadow: 0em -2.6em 0em 0em rgba(255,255,255, 0.2),
      1.8em -1.8em 0 0em rgba(255,255,255, 0.2),
      2.5em 0em 0 0em rgba(255,255,255, 0.5),
      1.75em 1.75em 0 0em rgba(255,255,255, 0.7),
      0em 2.5em 0 0em #ffffff,
      -1.8em 1.8em 0 0em rgba(255,255,255, 0.2),
      -2.6em 0em 0 0em rgba(255,255,255, 0.2),
      -1.8em -1.8em 0 0em rgba(255,255,255, 0.2);
  }
  62.5% {
    box-shadow: 0em -2.6em 0em 0em rgba(255,255,255, 0.2),
      1.8em -1.8em 0 0em rgba(255,255,255, 0.2),
      2.5em 0em 0 0em rgba(255,255,255, 0.2),
      1.75em 1.75em 0 0em rgba(255,255,255, 0.5),
      0em 2.5em 0 0em rgba(255,255,255, 0.7),
      -1.8em 1.8em 0 0em #ffffff,
      -2.6em 0em 0 0em rgba(255,255,255, 0.2),
      -1.8em -1.8em 0 0em rgba(255,255,255, 0.2);
  }
  75% {
    box-shadow: 0em -2.6em 0em 0em rgba(255,255,255, 0.2),
      1.8em -1.8em 0 0em rgba(255,255,255, 0.2),
      2.5em 0em 0 0em rgba(255,255,255, 0.2),
      1.75em 1.75em 0 0em rgba(255,255,255, 0.2),
      0em 2.5em 0 0em rgba(255,255,255, 0.5),
      -1.8em 1.8em 0 0em rgba(255,255,255, 0.7),
      -2.6em 0em 0 0em #ffffff,
      -1.8em -1.8em 0 0em rgba(255,255,255, 0.2);
  }
  87.5% {
    box-shadow: 0em -2.6em 0em 0em rgba(255,255,255, 0.2),
      1.8em -1.8em 0 0em rgba(255,255,255, 0.2),
      2.5em 0em 0 0em rgba(255,255,255, 0.2),
      1.75em 1.75em 0 0em rgba(255,255,255, 0.2),
      0em 2.5em 0 0em rgba(255,255,255, 0.2),
      -1.8em 1.8em 0 0em rgba(255,255,255, 0.5),
      -2.6em 0em 0 0em rgba(255,255,255, 0.7),
      -1.8em -1.8em 0 0em #ffffff;
  }
}
```

**CardView JSX** when pending:
```tsx
{pendingOp && (
  <div className="card-pending-overlay">
    <div className="loader" />
    <span className="label">{pendingOp.label}</span>
  </div>
)}
```

**Toast notifications:** Every operation shows a toast on completion or failure:
- Success: "Session forked" / "Moved to In Review" / "Prompt queued" / "Prompt sent"
- Failure: "Cannot move to In Review: no pull requests" / "Fork failed: ..."

**Per-operation feedback:**

| Operation | Immediate Visual | On SSE Confirm | On Failure |
|-----------|-----------------|----------------|------------|
| **Fork** | Original card shows "Forking..." spinner. New placeholder card appears in same column with spinner. | Placeholder replaced by real card from SSE. Toast "Session forked". | Placeholder removed. Toast with error. |
| **Column move** | Card shows "Moving..." spinner in original column. | Card moves to new column via SSE. Spinner clears. Toast "Moved to {column}". | Card stays in original column. Spinner clears. Toast with 422 reason. |
| **Add queued prompt** | Prompt appears in list immediately (optimistic). | Confirmed by SSE `card:updated`. | Prompt removed from list. Toast with error. |
| **Send queued prompt** | Prompt shows "Sending..." then disappears. | Confirmed by SSE. Toast "Prompt sent". | Prompt reappears. Toast with error. |
| **Remove queued prompt** | Prompt disappears immediately (optimistic). | Confirmed by SSE. | Prompt reappears. Toast with error. |
| **Send direct prompt** | Toast "Sending prompt..." | Toast "Prompt sent to session". | Toast with error. |

**Fork placeholder card pattern:**
When user clicks Fork, the client:
1. Calls `api.forkCard(cardId)`
2. Adds a `pendingForkCard` to a separate `pendingCards` array in the store:
   ```ts
   pendingCards: PendingCard[];
   // { id: 'pending-fork-xxx', sourceCardId, name: 'Fork of ...', column, projectPath }
   ```
3. BoardView renders pending cards alongside real cards (semi-transparent, spinner)
4. When SSE delivers a new card whose `sessionLink.sessionId` matches `forkedSessionId` from the API response, the pending card is removed
5. Toast "Session forked"

If the fork API fails, the pending card is removed and a toast shows the error.

## Implementation Approach

Vertical slices — each independently testable and committable.

---

## Slice 1: Queued Prompts

Fixes the biggest functional gap: UI buttons are no-ops today.

### Server: 4 routes in cards.ts

Add as sub-routes of `/:id`, following the factory pattern (closure-injected `store`):

**`POST /:id/queued-prompts`**
```
Route generates KSUID: generate('qp')
Constructs QueuedPrompt: { id, body, sendAutomatically, imagePaths }
Dispatches: { type: 'addQueuedPrompt', cardId, prompt }
Responds: 201 with the created QueuedPrompt
```

**`DELETE /:id/queued-prompts/:pid`**
```
Validates card exists (getState().links[id])
Dispatches: { type: 'removeQueuedPrompt', cardId, promptId }
Responds: 200 with updated link
```

**`POST /:id/queued-prompts/:pid/send`**
```
Validates card exists and prompt exists in queuedPrompts
Dispatches: { type: 'sendQueuedPrompt', cardId, promptId }
Responds: 200 with updated link
```

**`PATCH /:id/queued-prompts/:pid`**
```
Accepts: { body?, sendAutomatically? }
Dispatches: { type: 'updateQueuedPrompt', cardId, promptId, body, sendAutomatically }
Responds: 200 with updated link
```

All 4 actions already map to `card:updated` SSE event in `ACTION_TO_SSE_EVENT` (store-manager.ts:58-61). No SSE changes needed.

### Server: Bug fix

Fix effect type mismatch in effect-handler.ts: handler reads `effect.text` but Effect type declares `promptBody`. Align both to `promptBody` (matches the domain term).

Files: `board-store.ts` (Effect type union), `effect-handler.ts` (handler cases at lines 132-160).

### Client: api-client.ts

4 new methods:
```ts
addQueuedPrompt(cardId: string, body: string, sendAutomatically: boolean, imagePaths?: string[]): Promise<QueuedPrompt>
removeQueuedPrompt(cardId: string, promptId: string): Promise<Link>
sendQueuedPrompt(cardId: string, promptId: string): Promise<Link>
updateQueuedPrompt(cardId: string, promptId: string, patch: { body?: string; sendAutomatically?: boolean }): Promise<Link>
```

### Client: Store — pendingOps (store/index.ts)

Add to Zustand store (shared infrastructure used by all slices):
```ts
pendingOps: Record<string, PendingOperation>;
setPendingOp: (cardId: string, op: PendingOperation) => void;
clearPendingOp: (cardId: string) => void;
```

This is added once in Slice 1 and used by Slices 3 and 4.

### Client: Component wiring

**TerminalTabs.tsx:**
- Add `onAddQueuedPrompt` and `onUpdateQueuedPrompt` to `TerminalTabsProps`
- Add `useState<QueuedPrompt | null>(null)` for dialog editing state
- Add "Add Prompt" button to existing inline prompt bar
- Render `QueuedPromptDialog` (currently unused standalone component) with `isOpen`, `existingPrompt`, `onSave`, `onClose`
- Wire `onSave` → `onAddQueuedPrompt` (new) or `onUpdateQueuedPrompt` (editing)

**CardDetailView.tsx:**
- Add `onUpdateQueuedPrompt` to `CardDetailViewProps` (lines 47-71; other 3 already exist)
- Pass `onAddQueuedPrompt` through to TerminalTabContent (currently destructured at line 88 but dropped)
- Pass `onUpdateQueuedPrompt` through to TerminalTabContent

**App.tsx:**
- Wire all 4 callbacks with toast feedback when rendering `<CardDetailView>`:
  ```ts
  onAddQueuedPrompt={async (prompt) => {
    try {
      await api.addQueuedPrompt(selectedCardId, prompt.body, prompt.sendAutomatically, prompt.imagePaths);
      setToastMessage('Prompt queued');
    } catch (err) { setToastMessage(`Failed: ${err.message}`); }
  }}
  onSendQueuedPrompt={async (pid) => {
    try {
      await api.sendQueuedPrompt(selectedCardId, pid);
      setToastMessage('Prompt sent');
    } catch (err) { setToastMessage(`Failed: ${err.message}`); }
  }}
  onRemoveQueuedPrompt={async (pid) => {
    try { await api.removeQueuedPrompt(selectedCardId, pid); }
    catch (err) { setToastMessage(`Failed: ${err.message}`); }
  }}
  onUpdateQueuedPrompt={async (pid, patch) => {
    try {
      await api.updateQueuedPrompt(selectedCardId, pid, patch);
      setToastMessage('Prompt updated');
    } catch (err) { setToastMessage(`Failed: ${err.message}`); }
  }}
  ```

### Shared: api.ts

New request/response types:
```ts
interface AddQueuedPromptRequest { body: string; sendAutomatically: boolean; imagePaths?: string[] }
interface UpdateQueuedPromptRequest { body?: string; sendAutomatically?: boolean }
```

### Tests

- Server: 4 route tests in cards.test.ts (create, delete, send, update)
- Server: 4 reducer action tests in board-store.test.ts
- Client: Update TerminalTabs.test.tsx for add button + dialog flow

---

## Slice 2: Server-Computed Fields + Color Unification

Eliminates client-side domain logic that mobile would need to reimplement.

### Shared: Link interface (link.ts)

Add optional computed fields directly to `Link`:
```ts
// Server-computed display fields (set in buildEventPayload, never persisted)
displayTitle?: string;
cardLabel?: CardLabel;
worstPRStatus?: PRStatus | null;
projectName?: string | null;
effectiveAssistant?: string;
cardType?: 'sessions' | 'tasks' | 'issues' | 'other';  // plural to match existing filter values
```

`parseLinkFromJSON` (lines 286-377) explicitly lists every field — these are naturally ignored on deserialization. They're transient, computed fresh on every SSE broadcast.

TypeScript structural typing: components typed `link: Link` accept objects with extra optional fields — zero component type changes needed.

### Shared: New helpers (link.ts)

```ts
export function getProjectName(link: Link): string | null {
  return link.projectPath ? link.projectPath.split('/').filter(Boolean).pop() ?? null : null;
}

// NOTE: Return values use PLURAL forms to match existing getCardsInColumn filter values
// ('sessions', 'tasks', 'issues') which are already used in store/index.ts and URL params.
export function getCardType(link: Link): 'sessions' | 'tasks' | 'issues' | 'other' {
  if (link.sessionLink != null) return 'sessions';
  if (link.source === 'manual') return 'tasks';
  if (link.source === 'github_issue') return 'issues';
  return 'other';
}

export function enrichLink(link: Link): Link {
  return {
    ...link,
    displayTitle: getDisplayTitle(link),
    cardLabel: getCardLabel(link),
    worstPRStatus: getWorstPRStatus(link),
    projectName: getProjectName(link),
    effectiveAssistant: getEffectiveAssistant(link),
    cardType: getCardType(link),
  };
}

export function enrichLinks(links: Record<string, Link>): Record<string, Link> {
  const result: Record<string, Link> = {};
  for (const [id, link] of Object.entries(links)) {
    result[id] = enrichLink(link);
  }
  return result;
}
```

All dependencies already in scope in `link.ts` — no new imports.

### Shared: Color constants

New file `shared/src/types/colors.ts`:
```ts
export const PR_STATUS_COLORS: Record<string, string> = {
  failing: '#ef4444',
  unresolved: '#f97316',
  changes_requested: '#f97316',
  review_needed: '#eab308',  // was inconsistent: yellow in CardView, blue in PRBadge
  pending_ci: '#eab308',
  approved: '#22c55e',
  merged: '#a855f7',
  closed: '#6b7280',
  default: '#8e8e93',
};

export const CARD_LABEL_COLORS: Record<string, string> = {
  SESSION: '#f97316',
  WORKTREE: '#22c55e',
  ISSUE: '#3b82f6',
  PR: '#a855f7',
  TASK: '#6b7280',
};
```

Add `export * from './types/colors.js'` to `shared/src/index.ts`.

### Server: store-manager.ts

Inject enrichment at top of `buildEventPayload` (line ~131):

```ts
private buildEventPayload(action: Action, event: SSEEventType): Record<string, unknown> {
  const rawState = this.getClientState();
  const links = enrichLinks(rawState.links);
  const state = { ...rawState, links };
  const cardId = 'cardId' in action ? (action as { cardId: string }).cardId : undefined;
  // ... switch uses enriched state throughout
}
```

Single call, covers all 10 branches that include `state.links`.

### Client: Consume computed fields

**CardView.tsx:**
- Replace `getDisplayTitle(link)` → `link.displayTitle ?? getDisplayTitle(link)` (fallback for safety)
- Replace `getCardLabel(link)` → `link.cardLabel ?? getCardLabel(link)`
- Replace `getWorstPRStatus(link)` → `link.worstPRStatus` (check for undefined)
- Replace inline `projectPath.split('/').pop()` → `link.projectName`
- Replace `getEffectiveAssistant(link)` → `link.effectiveAssistant ?? getEffectiveAssistant(link)`
- Replace `getPRStatusColor()` function → `PR_STATUS_COLORS[status] ?? PR_STATUS_COLORS.default`

**CardDetailView.tsx:** Same replacements. Delete duplicated `getPRStatusColor` function. Delete duplicated `CardLabelBadge` component (import from CardView or extract to shared).

**PRBadge.tsx:** Replace `getBadgeColor()` → `PR_STATUS_COLORS[status] ?? PR_STATUS_COLORS.default`. Fixes the 2 color bugs.

**store/index.ts `getCardsInColumn`:** Simplify card-type filter:
```ts
// Before: if (cardType === 'sessions') return l.sessionLink != null;
// After:  if (cardType !== 'all') return l.cardType === cardType;
```

### Tests

- Shared: Test `enrichLink()`, `getProjectName()`, `getCardType()`
- Server: Verify buildEventPayload returns enriched fields
- Client: Verify CardView renders from computed fields

---

## Slice 3: Column Move + Server Validation

Fixes broken drag-and-drop + adds server-side validation.

### Server: Validation in cards.ts

Add pre-dispatch validation in `PATCH /:id` handler (before the existing `moveCard` dispatch):

```ts
if (column !== undefined) {
  const card = store.getState().links[id];
  const rejection = validateColumnMove(card, column as KanbanCodeColumn);
  if (rejection) {
    res.status(422).json({ error: rejection });
    return;
  }
  store.dispatch({ type: 'moveCard', cardId: id, column }, { isUserAction: true });
}
```

Pattern is race-safe (Node.js single-threaded, synchronous handler) with 5 existing precedents in cards.ts.

### Shared: Validation function

New export in `link.ts` (or `columns.ts`):
```ts
export function validateColumnMove(link: Link, toColumn: KanbanCodeColumn): string | null {
  if (toColumn === 'in_progress' && link.tmuxLink != null) {
    return 'Cannot move to In Progress: session is already running';
  }
  if (toColumn === 'in_review' && link.prLinks.length === 0) {
    return 'Cannot move to In Review: no pull requests';
  }
  if (toColumn === 'done' && !link.prLinks.some(pr => pr.status === 'merged')) {
    return 'Cannot move to Done: no merged pull request';
  }
  return null;
}
```

In shared so React Native can also use it for instant UI feedback (disable drop targets).

### Client: Wire onMoveCard

**App.tsx:** Add handler and pass to both views:
```ts
const handleMoveCard = useCallback(async (cardId: string, column: KanbanCodeColumn) => {
  setPendingMoveCardId(cardId);
  try {
    await api.updateCard(cardId, { column });
  } catch (err) {
    setToastMessage(err.message);  // shows 422 rejection reason
  } finally {
    setPendingMoveCardId(null);
  }
}, []);
```

Pass `onMoveCard={handleMoveCard}` to both `<BoardView>` and `<ListBoardView>` (currently omitted from both).
Pass `pendingMoveCardId` to both views for spinner rendering.

**DragAndDrop.tsx:** No changes to handleDragEnd. Add `pendingMoveCardId?: string` prop. Pass it through to card rendering.

**CardView.tsx:** When `link.id === pendingMoveCardId`, show a small spinner overlay.

### Cleanup

Delete `client/src/components/CardDropIntent.ts` and `client/src/components/__tests__/CardDropIntent.test.ts` — dead code (never imported by any component).

**Test parity requirement:** Before deleting `CardDropIntent.test.ts` (12 test cases), ensure `validateColumnMove` tests in shared cover ALL existing scenarios: `in_progress` with tmux running, `in_review` without PRs, `done` without merged PR, `all_sessions` (always allowed), `backlog` (always allowed), `requires_attention` (always allowed).

### Tests

- Server: Test PATCH /cards/:id with invalid column transitions returns 422
- Server: Test validateColumnMove rules — must cover all 12 existing CardDropIntent.test.ts cases
- Client: Test pendingMoveCardId spinner rendering
- Client: Test DnD → onMoveCard fires with correct args

---

## Slice 4: Missing Endpoints

### `GET /api/state` (index.ts)

```ts
app.get('/api/state', authMiddleware, (req, res) => {
  const rawState = store.getState();
  const links = enrichLinks(rawState.links);
  res.json({ ...rawState, links });
});
```

Depends on Slice 2 (`enrichLinks`). Returns same shape as SSE `state:snapshot`.

### `GET /api/assistants` (system.ts)

```ts
router.get('/assistants', (req, res) => {
  const descriptors = getAllAssistants().map(id => {
    const desc = getDescriptor(id);
    if (!desc) return null;
    const { hooks, ...clientSafe } = desc;  // strip server-only fields
    return clientSafe;
  }).filter(Boolean);
  res.json({ assistants: descriptors });
});
```

Uses `getAllAssistants()` (live read from `descriptorMap`) — race-safe.

### `POST /cards/:id/fork` (cards.ts)

**Key evidence:** All 3 SessionStore adapters implement `forkSession()` but return a **raw UUID string**, not a file path. To create the card immediately (for instant visual feedback), we add a `resolveSessionPath()` method to the SessionStore port.

**New port method** (`domain/ports/session-store.ts`):
```ts
resolveSessionPath(sessionId: string, originalPath: string): string;
```

**Adapter implementations** (one-liner each):
- Claude: `return path.join(path.dirname(originalPath), sessionId + '.jsonl');`
- Gemini: `return path.join(path.dirname(originalPath), 'session-forked-' + sessionId + '.json');`
- Kiro: `return 'kiro-sqlite://' + sessionId;`

**Route:**
```ts
router.post('/:id/fork', async (req, res) => {
  try {
    const { id } = req.params;
    const state = store.getState();
    const card = state.links[id];
    if (!card) return res.status(404).json({ error: 'Card not found' });

    const assistant = getEffectiveAssistant(card);
    const sessionStore = registry?.store(assistant);
    if (!sessionStore || !card.sessionLink?.sessionPath) {
      return res.status(400).json({ error: 'No session to fork' });
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
      source: 'manual',
    });
    store.dispatch({ type: 'createManualTask', link: newCard }, { isUserAction: true });
    res.status(201).json(newCard);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
```

**Visual feedback flow:**
1. User clicks Fork → original card shows "Forking..." spinner
2. API creates forked session + new card → dispatches `createManualTask` → SSE `card:updated`
3. Client receives SSE → new card appears immediately on the board
4. Spinner clears on original card. Toast "Session forked".

Client: Replace raw `fetch()` in App.tsx `handleForkCard` with `api.forkCard(cardId)`. Add `setPendingOp` before call, `clearPendingOp` after.

### `POST /cards/:id/send-prompt` (cards.ts)

New reducer action `sendDirectPrompt`:
```ts
// board-store.ts action type
{ type: 'sendDirectPrompt'; cardId: string; body: string; imagePaths?: string[] }

// reducer case — pushes tmux effect without touching queue
case 'sendDirectPrompt': {
  const link = state.links[action.cardId];
  if (!link?.tmuxLink) break;
  const sessionName = getTmuxAllSessionNames(link.tmuxLink)[0];
  const assistant = getEffectiveAssistant(link);
  if (action.imagePaths?.length) {
    effects.push({ type: 'sendPromptWithImagesToTmux', sessionName, promptBody: action.body, imagePaths: action.imagePaths, assistant });
  } else {
    effects.push({ type: 'sendPromptToTmux', sessionName, promptBody: action.body, assistant });
  }
  break;
}
```

Route: `POST /cards/:id/send-prompt` accepts `{ body, imagePaths? }`, dispatches `sendDirectPrompt`.

Add to `ACTION_TO_SSE_EVENT`: `sendDirectPrompt: 'card:updated'`.

### Shared: api.ts

New types:
```ts
// Fork now returns full Link (card created immediately server-side)
interface SendPromptRequest { body: string; imagePaths?: string[] }
interface AssistantsResponse { assistants: Omit<AssistantDescriptor, 'hooks'>[] }
interface StateResponse extends StateSnapshot {}  // same as SSE snapshot
```

### Client: api-client.ts

New methods:
```ts
forkCard(cardId: string): Promise<Link>
sendPrompt(cardId: string, body: string, imagePaths?: string[]): Promise<void>
getState(): Promise<StateSnapshot>
getAssistants(): Promise<AssistantsResponse>
```

### Tests

- Server: Test all 4 new endpoints
- Server: Test sendDirectPrompt reducer action
- Client: Test api-client methods

---

## Slice 5: Type Completeness

### Shared: events.ts — 11 new SSE payload interfaces

```ts
interface CardsReorderedEvent { state: { links: Record<string, Link> } }
interface CardsReconciledEvent { state: StateSnapshot }
interface TerminalCreatedEvent { cardId: string; state: { links: Record<string, Link> } }
interface TerminalFailedEvent { cardId: string; error: string; state: { links: Record<string, Link>; error: string } }
interface ErrorEvent { message: string; state: { error: string } }
interface LoadingEvent { isLoading: boolean; state: { isLoading: boolean } }
interface BacklogRefreshingEvent { isRefreshingBacklog: boolean; state: { isRefreshingBacklog: boolean } }
interface SettingsLoadedEvent { state: { configuredProjects: Project[]; excludedPaths: string[] } }
interface GithubIssuesUpdatedEvent { state: { links: Record<string, Link>; lastGitHubRefresh: string } }
interface GithubRateLimitedEvent { repos: string[]; state: { rateLimitedRepos: string[] } }
interface MigrationFailedEvent { cardId: string; error: string; state: { links: Record<string, Link>; error: string } }
```

Remove `'notification:fired'` from `SSE_EVENT_TYPES` (dead code — not in ACTION_TO_SSE_EVENT, unreachable).

### Shared: api.ts — 7 new REST response types

```ts
interface BulkActionResponse { succeeded: string[]; skipped: string[] }
interface TmuxSessionsResponse { sessions: TmuxSession[] }
interface WorktreesResponse { worktrees: Record<string, Worktree[]> }
interface BacklogResponse { backlog: Array<{ project: string; issues: unknown[] }> }
interface ReorderResponse { ok: true }
interface SettingsResponse { [key: string]: unknown }  // full settings object
interface HooksStatusResponse { hooks: Record<string, boolean> }
```

### Shared: New file `terminal-protocol.ts`

```ts
// Server → Client JSON messages
type TerminalServerMessage =
  | { type: 'exit'; code: number | undefined; signal: number | undefined }
  | { type: 'error'; message: string };

// Client → Server JSON messages
type TerminalClientMessage =
  | { type: 'resize'; cols: number; rows: number };
```

Add `export * from './types/terminal-protocol.js'` to `index.ts`.

### Cleanup

- Update server `terminal-handler.ts` to import and use shared message types
- Update client `ws-manager.ts` to import and use shared message types
- Update client `store/index.ts` `applyEvent` to reference specific event types in comments

### Tests

- Shared: Type-check tests verifying event interfaces match buildEventPayload output shapes

---

## Dependency Order

```
Slice 5 (types) ──┐
                   ├──→ Slice 2 (computed fields) ──→ Slice 4 (/api/state uses enrichLinks)
Slice 1 (queued)   │
Slice 3 (column)   │
                   │
All slices independent except: Slice 4 /api/state depends on Slice 2 enrichLinks
```

Recommended order: **1 → 3 → 2 → 5 → 4** (functional fixes first, then computed fields, then types, then remaining endpoints).

---

## Files Modified Per Slice

### Slice 1 (12 files)
- `server/src/routes/cards.ts` — 4 new routes
- `server/src/usecases/board-store.ts` — fix Effect type (promptBody)
- `server/src/usecases/effect-handler.ts` — fix field name mismatch
- `client/src/lib/api-client.ts` — 4 new methods
- `client/src/store/index.ts` — add pendingOps state + actions (shared by all slices)
- `client/src/components/App.tsx` — wire 4 callbacks with toast feedback to CardDetailView
- `client/src/components/CardDetailView.tsx` — add onUpdateQueuedPrompt prop, pass onAddQueuedPrompt through
- `client/src/components/TerminalTabs.tsx` — add onAddQueuedPrompt/onUpdateQueuedPrompt, add button, render QueuedPromptDialog
- `client/src/components/CardView.tsx` — render pendingOps spinner overlay
- `shared/src/types/api.ts` — 2 new request types
- Plus 3 test files

### Slice 2 (10 files)
- `shared/src/types/link.ts` — optional computed fields + enrichLink + getProjectName + getCardType
- `shared/src/types/colors.ts` — new file (PR_STATUS_COLORS, CARD_LABEL_COLORS)
- `shared/src/index.ts` — re-export colors
- `server/src/usecases/store-manager.ts` — enrichLinks call in buildEventPayload
- `client/src/components/CardView.tsx` — consume computed fields, use shared colors
- `client/src/components/CardDetailView.tsx` — consume computed fields, use shared colors, remove duplicate CardLabelBadge
- `client/src/components/PRBadge.tsx` — use shared colors (fixes 2 bugs)
- `client/src/store/index.ts` — simplify getCardsInColumn filter
- Plus 2 test files

### Slice 3 (8 files)
- `shared/src/types/link.ts` (or columns.ts) — validateColumnMove function
- `server/src/routes/cards.ts` — pre-dispatch validation in PATCH handler
- `client/src/components/App.tsx` — wire onMoveCard + pendingMoveCardId
- `client/src/components/DragAndDrop.tsx` — add pendingMoveCardId prop
- `client/src/components/CardView.tsx` — spinner when pending
- `client/src/components/BoardView.tsx` — pass pendingMoveCardId through
- DELETE `client/src/components/CardDropIntent.ts`
- DELETE `client/src/components/__tests__/CardDropIntent.test.ts`
- Plus 3 test files

### Slice 4 (13 files)
- `server/src/domain/ports/session-store.ts` — add resolveSessionPath method
- `server/src/adapters/claude/session-store.ts` — implement resolveSessionPath (1 line)
- `server/src/adapters/gemini/session-store.ts` — implement resolveSessionPath (1 line)
- `server/src/adapters/kiro/session-store.ts` — implement resolveSessionPath (1 line)
- `server/src/index.ts` — /api/state route
- `server/src/routes/system.ts` — /api/assistants route
- `server/src/routes/cards.ts` — fork + send-prompt routes
- `server/src/usecases/board-store.ts` — sendDirectPrompt action
- `server/src/usecases/store-manager.ts` — ACTION_TO_SSE_EVENT entry
- `client/src/lib/api-client.ts` — 4 new methods
- `client/src/components/App.tsx` — swap raw fetch to api-client for fork + pendingOps
- `shared/src/types/api.ts` — new types
- Plus 4 test files

### Slice 5 (6 files)
- `shared/src/types/events.ts` — 11 new interfaces, remove notification:fired
- `shared/src/types/api.ts` — 7 new response types
- `shared/src/types/terminal-protocol.ts` — new file
- `shared/src/index.ts` — re-export terminal-protocol
- `server/src/ws/terminal-handler.ts` — import shared types
- `client/src/lib/ws-manager.ts` — import shared types
- Plus 1 test file
