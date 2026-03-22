# SP3a: Mobile Card Actions

**Date:** 2026-03-16
**Goal:** Long-press action sheet on cards, pendingOps spinners, launch/resume/fork in detail screen, assistant filter.

## New/Modified Files

| File | Change |
|------|--------|
| `src/components/CardItem.tsx` | Add `onLongPress`, read `pendingOps` from store, show spinner overlay |
| `src/components/CardActionSheet.tsx` | NEW — Action sheet modal: Move to Column, Archive, Delete, Launch, Resume |
| `src/components/FilterBar.tsx` | Add assistant filter row |
| `src/screens/BoardScreen.tsx` | Wire action handlers, pass pendingOps context |
| `src/screens/CardDetailScreen.tsx` | Add Launch/Resume/Fork buttons with pendingOps |
| `src/lib/api-client.ts` | Add `forkCard`, `sendPrompt` methods |

## CardItem Changes

Add `onLongPress` prop + `pendingOps` reading:
```tsx
interface CardItemProps {
  link: Link;
  onPress: () => void;
  onLongPress?: () => void;
  pendingOp?: { type: string; label: string } | null;
}
```

Show spinner overlay when `pendingOp` is set (same pattern as `isLaunching`).

## CardActionSheet

Modal triggered by long-press. Shows contextual actions based on card state:

```
┌─────────────────────────────┐
│ Move to Column →            │
│   ○ Backlog                 │
│   ○ In Progress             │
│   ● Waiting (current)       │
│   ○ Requires Attention      │
│   ○ In Review               │
│   ○ Done                    │
│   ○ All Sessions            │
├─────────────────────────────┤
│ Launch Session              │  (if no tmuxLink)
│ Resume Session              │  (if has sessionLink)
├─────────────────────────────┤
│ Archive                     │
│ Delete Card                 │  (red, with Alert confirmation)
└─────────────────────────────┘
```

Column move:
1. Call `validateColumnMove(link, targetColumn)` locally — show error if invalid
2. `setPendingOp(cardId, { type: 'move', label: 'Moving...' })`
3. `await api.updateCard(cardId, { column: targetColumn })`
4. `clearPendingOp(cardId)` in finally
5. SSE `card:updated` moves the card on the board

## CardDetailScreen Actions

Add action buttons below the tab bar:

```
[▶ Launch]  [↻ Resume]  [⑂ Fork]  [Archive]
```

- **Launch**: visible when `!link.tmuxLink`. Calls `api.launchCard(cardId, { prompt: link.promptBody, projectPath: link.projectPath, skipPermissions: true })`
- **Resume**: visible when `link.sessionLink`. Calls `api.resumeCard(cardId)`
- **Fork**: visible when `link.sessionLink`. Calls `api.forkCard(cardId)`
- All use `setPendingOp`/`clearPendingOp` + toast feedback

## API Client Additions

```ts
forkCard: (cardId: string) =>
  request<Link>(`/cards/${cardId}/fork`, { method: 'POST' }),
sendPrompt: (cardId: string, body: string, imagePaths?: string[]) =>
  request<void>(`/cards/${cardId}/send-prompt`, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ body, imagePaths }),
  }),
```

## FilterBar Assistant Row

Add a third row with assistant chips:
```
[All] [Claude] [Gemini] [Kiro]
```
Uses `ALL_ASSISTANTS` from shared + `getShortDisplayName` for labels + `getAssistantColor` for active chip color.
