# SP2: Board + Cards UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Replace BoardScreen stub with vertical-section kanban board showing cards, collapsible columns, filter bar, and card detail push screen.

**Architecture:** SectionList with collapsible sections (empty data hides items). All card display data pre-computed by server via enrichLink. Navigation via typed BoardStackParamList.

**Tech Stack:** React Native SectionList, @react-navigation/native-stack, @expo/vector-icons, @kanban-code/shared

---

## Parallelization

```
Wave 1 (4 parallel): utilities + components (no file overlap)
  Agent A: utils/time.ts + utils/colors.ts
  Agent B: components/CardItem.tsx + components/AssistantDot.tsx
  Agent C: components/SectionHeader.tsx + components/FilterBar.tsx
  Agent D: screens/CardDetailScreen.tsx + navigation/types.ts

Wave 2 (2 parallel): integration
  Agent E: screens/BoardScreen.tsx (full rewrite)
  Agent F: navigation/RootNavigator.tsx (add CardDetail + icons)
```

---

## Wave 1 — Parallel Components

### Task A: Utilities

**Files:**
- [x] Create: `mobile/src/utils/time.ts`
- [x] Create: `mobile/src/utils/colors.ts`

`mobile/src/utils/time.ts`:
```ts
export function formatRelativeTime(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
```

`mobile/src/utils/colors.ts`:
```ts
export const COLUMN_ACCENT_COLORS: Record<string, string> = {
  backlog: '#8e8e93',
  in_progress: '#22c55e',
  requires_attention: '#f97316',
  in_review: '#3b82f6',
  done: '#a855f7',
  all_sessions: '#8e8e93',
};
```

---

### Task B: CardItem + AssistantDot

**Files:**
- [x] Create: `mobile/src/components/AssistantDot.tsx`
- [x] Create: `mobile/src/components/CardItem.tsx`

---

### Task C: SectionHeader + FilterBar

**Files:**
- [x] Create: `mobile/src/components/SectionHeader.tsx`
- [x] Create: `mobile/src/components/FilterBar.tsx`

---

### Task D: CardDetailScreen + navigation types

**Files:**
- [x] Create: `mobile/src/navigation/types.ts`
- [x] Create: `mobile/src/screens/CardDetailScreen.tsx`

---

## Wave 2 — Integration

### Task E: BoardScreen rewrite

**Files:**
- [x] Modify: `mobile/src/screens/BoardScreen.tsx`

### Task F: RootNavigator update

**Files:**
- [x] Modify: `mobile/src/navigation/RootNavigator.tsx`
