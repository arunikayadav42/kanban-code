# Bulk Select & Actions — Design Specification

**Date:** 2026-03-15
**Status:** Code-validated
**Scope:** Multi-card selection with bulk archive, resume, and move-to-project

---

## 1. Overview

Add multi-card selection to the kanban board with three bulk actions: Archive, Resume, and Move to Project. Selection uses checkboxes on cards + three-state toggle in column headers. A bulk action bar appears below the column header when cards are selected.

## 2. Selection UX

### Card Checkbox
- Checkbox in top-left corner of each card
- Visible on hover; always visible when any card in the column is selected
- `stopPropagation` on checkbox click (same pattern as existing play button)
- Title gets `paddingLeft: 28px` to avoid text overlap
- Clicking card body (not checkbox) still opens detail panel (existing behavior unchanged)

### Column Header — Three-State Toggle
- **Unchecked**: no cards in this column are selected
- **Checked**: all cards in this column are selected
- **Indeterminate** (dash): some cards selected
- Click: unchecked/indeterminate → select all. Checked → deselect all.

### Selection State
- New Zustand field: `selectedCardIds: Set<string>` (client-only, not in AppState or SSE)
- Cleared on project switch (`useEffect` watching `selectedProjectPath`)
- Cleared after successful bulk operation
- Stale IDs (cards deleted by reconciler) are harmless — bulk endpoints skip missing cards

## 3. Bulk Action Bar

Slides in below column header when `selectedCardIds` intersects with column's cards. Fixed position (doesn't scroll with cards — confirmed by flex layout).

Contents:
- **Count + deselect**: "3 selected" + "Deselect all" link
- **Archive**: "Archive 3" — always enabled
- **Resume**: "Resume 2 of 3" — count of cards with `sessionLink`. Hidden when 0 eligible.
- **Move to Project**: dropdown with configured projects

### Confirmation Dialog
All bulk operations show a confirmation dialog before executing:
- Title: "Archive 12 cards?" / "Resume 5 cards?" / "Move 8 cards to ProjectName?"
- Scrollable list of affected card titles (max 10 shown, "+N more" for overflow)
- Cancel / Confirm buttons

## 4. Backend — Reducer

### New Action Types

```typescript
| { type: 'bulkArchive'; cardIds: string[] }
| { type: 'bulkResume'; cardIds: string[] }
| { type: 'bulkMoveToProject'; cardIds: string[]; projectPath: string }
```

### `bulkArchive` Handler
- Loop over `cardIds`, read each from `newState.links` (accumulating)
- For each: set `column: 'all_sessions'`, `manuallyArchived: true`, `tmuxLink: null`
- Collect all tmux session names across all cards
- Effects: one `persistLinks` (atomic full write) + one `killTmuxSessions` (batched names) + one `cleanupTerminalCache`

### `bulkResume` Handler
- Loop over `cardIds`, skip cards without `sessionLink`
- For each eligible: set `isLaunching: true`, `column: 'in_progress'`, create `tmuxLink`, clear `manuallyArchived`
- Does NOT set `selectedCardId` (unlike single `resumeCard`)
- Effects: one `persistLinks`
- Returns list of eligible cardIds in state for the route handler to launch

### `bulkMoveToProject` Handler
- Loop over `cardIds`, read each from accumulating `newState.links`
- For each: set `projectPath`, clear `worktreeLink`, `prLinks`, `discoveredBranches`, `discoveredRepos`, `tmuxLink`
- Collect tmux names, collect moveSessionFile params
- Effects: one `persistLinks` + one `killTmuxSessions` + N `moveSessionFile` (can't be batched — per-card file paths)

## 5. Backend — SSE

Map all 3 bulk actions to `card:updated` in `ACTION_TO_SSE_EVENT`. The `card:updated` event already sends `{ state: { links } }` (full links map). Client replaces all links on receive. One dispatch = one SSE event. No new event type needed.

## 6. Backend — REST Endpoints

### `POST /api/cards/bulk-archive`
```
Body: { cardIds: string[] }
Response: { succeeded: string[], skipped: string[] }
```
Dispatches `bulkArchive`. Returns immediately.

### `POST /api/cards/bulk-resume`
```
Body: { cardIds: string[] }
Response: { succeeded: string[], skipped: string[] }
```
Dispatches `bulkResume` (sets `isLaunching` state). Then calls `launcher.resume()` for each eligible card, **capped at 5 concurrent** via a simple queue. Each launch's `.then()` dispatches `resumeCompleted`, `.catch()` dispatches `resumeFailed`. Response returns immediately — launch results arrive via SSE.

### `POST /api/cards/bulk-move-project`
```
Body: { cardIds: string[], projectPath: string }
Response: { succeeded: string[], skipped: string[] }
```
Dispatches `bulkMoveToProject`. Returns immediately.

### `POST /api/cards/:id/move-to-project` (new single-card endpoint)
```
Body: { projectPath: string }
Response: Link
```
Dispatches `moveCardToProject`. (Currently missing — PATCH doesn't handle projectPath.)

## 7. Backend — Resume Concurrency Cap

To prevent resource exhaustion from bulk resume:

```typescript
async function launchWithCap(
  cards: Array<{ cardId: string; sessionId: string; projectPath: string; assistant: string }>,
  launcher: LaunchSession,
  dispatch: (action: Action) => void,
  maxConcurrent: number = 5,
): Promise<void> {
  for (let i = 0; i < cards.length; i += maxConcurrent) {
    const batch = cards.slice(i, i + maxConcurrent);
    await Promise.allSettled(
      batch.map(card =>
        launcher.resume({ sessionId: card.sessionId, projectPath: card.projectPath, assistant: card.assistant })
          .then(tmuxName => dispatch({ type: 'resumeCompleted', cardId: card.cardId, tmuxName }))
          .catch(err => dispatch({ type: 'resumeFailed', cardId: card.cardId, error: String(err) }))
      )
    );
  }
}
```

Launches 5 at a time, waits for batch to settle, then next 5. Individual success/failure dispatched per card.

## 8. Client — Files

| File | Change |
|------|--------|
| `store/index.ts` | Add `selectedCardIds: Set<string>`, `toggleCardSelection(id)`, `selectAllInColumn(ids)`, `deselectAllInColumn(ids)`, `clearSelection()` |
| `CardView.tsx` | Add checkbox top-left (hover-visible, `stopPropagation`), title `paddingLeft` when checkbox visible, new props: `isChecked`, `onToggleCheck` |
| `ColumnView.tsx` | Three-state header checkbox, `BulkActionBar` component below header, new props: `selectedCardIds`, `onToggleCardSelection`, `onSelectAllInColumn`, `onBulkArchive`, `onBulkResume`, `onBulkMoveProject` |
| `App.tsx` | Wire bulk handlers (`handleBulkArchive`, `handleBulkResume`, `handleBulkMoveProject`), `useEffect` to clear selection on project switch, confirmation dialog state |
| `BulkConfirmDialog.tsx` | New component — confirmation dialog for bulk operations |
| `api-client.ts` | Add `bulkArchive(ids)`, `bulkResume(ids)`, `bulkMoveProject(ids, path)`, `moveCardToProject(id, path)` |

## 9. Server — Files

| File | Change |
|------|--------|
| `board-store.ts` | Add 3 bulk action types + reducer handlers |
| `store-manager.ts` | Map 3 bulk actions → `card:updated` in `ACTION_TO_SSE_EVENT` |
| `routes/cards.ts` | Add 4 endpoints (3 bulk + 1 single move-to-project) |

## 10. Known Tradeoffs

| Concern | Decision | Rationale |
|---------|----------|-----------|
| `persistLinks` writes all 700+ cards | Accept | Atomic correctness over per-card efficiency |
| Resume not atomic | Accept | Individual `isLaunching` spinners + `resumeCompleted/Failed` SSE events handle it |
| `moveSessionFile` can't batch | Accept | Per-card file paths, I/O contention unlikely at typical scale |
| `card:updated` sends full links map | Accept | Pre-existing design, bulk doesn't make it worse |
| Selection not synced across tabs | Accept | Client-local concern, bulk actions are intentional single-session operations |
| SortableCard dnd-kit wrapper | Verify | Checkbox may need `pointer-events` isolation from drag handle |
