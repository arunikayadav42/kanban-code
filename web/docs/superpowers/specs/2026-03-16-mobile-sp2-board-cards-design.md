# SP2: React Native Mobile App — Board + Cards UI

**Date:** 2026-03-16
**Goal:** Replace BoardScreen stub with a full vertical-section kanban board showing cards, collapsible columns, filter bar, and card detail push screen.

**Depends on:** SP1 (scaffold + data layer) — complete and running on device.

## Evidence-Based Decisions

| Decision | Evidence | Choice |
|----------|----------|--------|
| Board layout | User selected vertical collapsible sections (visual mockup) | SectionList with collapse toggle |
| Collapse pattern | Web ListBoardView:102-121 uses `Set<KanbanCodeColumn>` toggle + empty data | Same pattern, AsyncStorage for persistence |
| Card data | All 7 enriched fields arrive via SSE (enrichLink in buildEventPayload) | Zero helper calls for rendering |
| `getCardsInColumn` | EXISTS in mobile store (lines 134-155) | Use as-is |
| Project list | No `projects` state in store, but `link.projectName` is enriched | Derive from `links` — no API call |
| Column colors | `COLUMN_ACCENT_COLORS` not in shared (web ListBoardView:20 only) | Define locally in mobile |
| Navigation | React Navigation 7 typed params | Pass `cardId` string, read Link from store |
| Icons | AssistantIcon needs react-native-svg; tab icons via @expo/vector-icons (bundled) | Install react-native-svg |
| Sticky headers | Android needs explicit `stickySectionHeadersEnabled={true}` | Set prop |

## New Files

| File | Purpose |
|------|---------|
| `src/components/CardItem.tsx` | Single card row: title, badges, time, project, assistant |
| `src/components/SectionHeader.tsx` | Column header: name, count badge, collapse chevron |
| `src/components/FilterBar.tsx` | Project picker + card type chips |
| `src/components/AssistantDot.tsx` | Colored dot for assistant (simpler than SVG icon for SP2) |
| `src/utils/time.ts` | `formatRelativeTime(isoDate)` |
| `src/utils/colors.ts` | `COLUMN_ACCENT_COLORS` constant |
| `src/screens/CardDetailScreen.tsx` | Push screen: card header + placeholder tabs |
| `src/navigation/types.ts` | `BoardStackParamList` type definition |

## Modified Files

| File | Change |
|------|--------|
| `src/screens/BoardScreen.tsx` | Replace stub with SectionList + FilterBar + collapse logic |
| `src/navigation/RootNavigator.tsx` | Add CardDetailScreen to BoardStack + tab icons |

## Component Specifications

### CardItem

Renders a single card as a pressable row. All display data from enriched `Link`:

```
┌─────────────────────────────────────────────┐
│ ● Claude  API Separation Design         5m  │
│           kanban-code-main                   │
│   [TASK] [SESSION]          ■ PR: approved   │
└─────────────────────────────────────────────┘
```

Props: `link: Link`, `onPress: () => void`

Data mapping (zero computation):
- `link.displayTitle` → title text (numberOfLines={2})
- `link.projectName` → subtitle
- `link.effectiveAssistant` → colored dot + short name
- `link.cardLabel` → primary badge
- `link.cardSourceLabel` → secondary badge (when differs from cardLabel)
- `link.worstPRStatus` → PR badge color via `PR_STATUS_COLORS[status]`
- `link.lastActivity ?? link.updatedAt` → relative time via `formatRelativeTime()`
- `link.isLaunching` → ActivityIndicator overlay
- Left border color from `COLUMN_ACCENT_COLORS[link.column]`

### SectionHeader

Collapsible column header:

```
▼ In Progress                              3
```

Props: `column: KanbanCodeColumn`, `count: number`, `isCollapsed: boolean`, `onToggle: () => void`

- `getColumnDisplayName(column)` from shared
- Chevron rotates: ▼ expanded, ▶ collapsed
- Count badge always shows real count (not filtered by collapse)
- Background: `#1c1c1e`, sticky

### FilterBar

Horizontal row at top of board:

```
[All Projects ▾]  [All] [Sessions] [Tasks] [Issues]
```

- Project picker: derived from `new Set(Object.values(links).map(l => l.projectName).filter(Boolean))`
- Card type: 4 chip buttons (all/sessions/tasks/issues)
- Reads/writes `selectedProjectPath`, `selectedAssistant`, `selectedCardType` from store

### AssistantDot

Simple colored dot instead of full SVG icon (defer react-native-svg to SP3):

```tsx
<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: getAssistantColor(assistant) }} />
```

Uses `getAssistantColor()` from shared (returns hex string from descriptor).

### CardDetailScreen

Push screen when card is tapped:

```
← Back    API Separation Design    ···
──────────────────────────────────────
kanban-code-main · Claude · SESSION
──────────────────────────────────────
[Terminal] [History] [Prompt]

Terminal content (SP4)
```

- Route param: `{ cardId: string }`
- Reads `link = useBoardStore(s => s.links[cardId])`
- Header: back button + title + actions menu (···)
- Metadata row: project, assistant, labels
- Tab bar: Terminal / History / Prompt (all placeholder text for SP2)
- Actions menu (long-press ···): Archive, Delete (with confirmation)

## BoardScreen Architecture

```tsx
export default function BoardScreen() {
  // SSE connection (existing from SP1)
  useSSE({ onEvent, onConnect, onError });

  // Store
  const links = useBoardStore(s => s.links);
  const selectedProjectPath = useBoardStore(s => s.selectedProjectPath);
  const selectedAssistant = useBoardStore(s => s.selectedAssistant);
  const selectedCardType = useBoardStore(s => s.selectedCardType);

  // Collapse state (local, persisted to AsyncStorage)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => { loadCollapsedFromStorage().then(setCollapsed); }, []);

  // Sections
  const sections = useMemo(() =>
    ALL_COLUMNS.map(col => ({
      title: col,
      data: collapsed.has(col) ? [] : getCardsInColumn(links, col, selectedProjectPath, selectedAssistant, selectedCardType),
    })),
  [links, collapsed, selectedProjectPath, selectedAssistant, selectedCardType]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <FilterBar />
      <SectionList
        sections={sections}
        stickySectionHeadersEnabled={true}
        renderSectionHeader={({ section }) => (
          <SectionHeader
            column={section.title}
            count={getCardsInColumn(links, section.title, selectedProjectPath, selectedAssistant, selectedCardType).length}
            isCollapsed={collapsed.has(section.title)}
            onToggle={() => toggleCollapse(section.title)}
          />
        )}
        renderItem={({ item }) => (
          <CardItem link={item} onPress={() => navigation.navigate('CardDetail', { cardId: item.id })} />
        )}
        keyExtractor={item => item.id}
      />
    </SafeAreaView>
  );
}
```

## Utilities

### formatRelativeTime

```ts
export function formatRelativeTime(isoDate: string): string {
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

### COLUMN_ACCENT_COLORS

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

## Dependencies to Add

```bash
npx expo install react-native-svg
```

Only needed for SP3's full AssistantIcon. SP2 uses AssistantDot (colored circle, no SVG).

## What SP2 Delivers (Testable)

1. Board shows all cards in collapsible vertical sections
2. Sections collapse/expand with persisted state
3. Cards show title, project, assistant, badges, relative time, accent color
4. Dual badges (TASK + SESSION) for launched manual tasks
5. Filter by project, card type
6. Tap card → pushes CardDetailScreen with card info
7. Tab icons on bottom navigation
8. Sticky section headers on scroll

## Verification

```
1. Open app → Board tab shows sections with cards
2. Tap section header → collapses/expands
3. Background + foreground → sections stay collapsed
4. Tap project filter → cards filter
5. Tap card type chip → cards filter
6. Tap a card → detail screen pushes with card title + metadata
7. Back button returns to board
8. SSE update arrives → card list updates live
```
