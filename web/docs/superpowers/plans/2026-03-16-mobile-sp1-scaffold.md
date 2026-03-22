# SP1: React Native Mobile App — Scaffold + Data Layer

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expo RN project that boots on Android, connects to the Kanban Code backend via configurable URL, receives SSE state, and navigates between 3 tabs.

**Architecture:** BootGate pattern gates all rendering behind async hydration + backend validation. Store ported from web with AsyncStorage. SSE via react-native-sse in BoardScreen (not BootGate — avoids stale closure bug) with AppState foreground reconnect. Shared types via Metro watchFolders + .js→.ts resolver.

**Evidence-based corrections applied:**
- `applySnapshot` reads `data.state?.links` (not `data.links`) — server nests links under `state`
- `applyEvent` handles `error`-only events (no links in payload)
- `getCardsInColumn` copied to mobile store (not in @kanban-code/shared)
- api-client has 29 methods (not 27), import uses extensionless path
- react-native-sse `e.data` can be null — guard before JSON.parse
- useSSE lives in BoardScreen (not BootGate) to avoid stale closure when backendUrl set before phase=ready

**Tech Stack:** Expo 52, React Native 0.76, Zustand 5, react-native-sse, @react-navigation 7, react-native-reanimated, @kanban-code/shared

**Spec:** `web/docs/superpowers/specs/2026-03-16-mobile-sp1-scaffold-design.md`

---

## File Structure

```
mobile/
├── app.json
├── package.json
├── metro.config.js
├── babel.config.js
├── tsconfig.json
├── App.tsx
├── src/
│   ├── boot/
│   │   └── BootGate.tsx
│   ├── store/
│   │   └── index.ts
│   ├── lib/
│   │   ├── api-client.ts
│   │   └── ws-manager.ts
│   ├── hooks/
│   │   └── useSSE.ts
│   ├── navigation/
│   │   └── RootNavigator.tsx
│   └── screens/
│       ├── ConnectScreen.tsx
│       ├── BoardScreen.tsx
│       ├── SearchScreen.tsx
│       └── SettingsScreen.tsx
```

---

## Task 1: Expo Project Scaffold

**Files:**
- Create: `mobile/package.json`
- Create: `mobile/app.json`
- Create: `mobile/tsconfig.json`
- Create: `mobile/babel.config.js`
- Create: `mobile/metro.config.js`
- Create: `mobile/App.tsx`

- [x] **Step 1: Create mobile directory and initialize Expo**
- [x] **Step 2: Install core dependencies**
- [x] **Step 3: Configure Metro for @kanban-code/shared**
- [x] **Step 4: Configure Babel**
- [x] **Step 5: Configure TypeScript**
- [x] **Step 6: Write minimal App.tsx**
- [x] **Step 7: Verify shared types resolve**
- [x] **Step 8: Commit**

---

## Task 2: Zustand Store (AsyncStorage Port)

**Files:**
- Create: `mobile/src/store/index.ts`

- [x] **Step 1: Port store from web with AsyncStorage**
- [x] **Step 2: Verify store creates without crash**
- [x] **Step 3: Commit**

---

## Task 3: API Client + WS Manager

**Files:**
- Create: `mobile/src/lib/api-client.ts`
- Create: `mobile/src/lib/ws-manager.ts`

- [x] **Step 1: Copy and adapt api-client**
- [x] **Step 2: Copy and adapt ws-manager**
- [x] **Step 3: Commit**

---

## Task 4: SSE Hook with AppState Reconnect

**Files:**
- Create: `mobile/src/hooks/useSSE.ts`

- [x] **Step 1: Create useSSE with react-native-sse + AppState**
- [x] **Step 2: Commit**

---

## Task 5: ConnectScreen

**Files:**
- Create: `mobile/src/screens/ConnectScreen.tsx`

- [x] **Step 1: Create ConnectScreen**
- [x] **Step 2: Commit**

---

## Task 6: Navigation + Placeholder Screens

**Files:**
- Create: `mobile/src/navigation/RootNavigator.tsx`
- Create: `mobile/src/screens/BoardScreen.tsx`
- Create: `mobile/src/screens/SearchScreen.tsx`
- Create: `mobile/src/screens/SettingsScreen.tsx`

- [x] **Step 1: Create placeholder screens**
- [x] **Step 2: Create RootNavigator**
- [x] **Step 3: Commit**

---

## Task 7: BootGate + App Integration

**Files:**
- Create: `mobile/src/boot/BootGate.tsx`
- Modify: `mobile/App.tsx`

- [x] **Step 1: Create BootGate**
- [x] **Step 2: Update App.tsx to use BootGate**
- [x] **Step 3: Verify full boot sequence**
- [x] **Step 4: Test SSE reconnect**
- [x] **Step 5: Test backend URL change**
- [x] **Step 6: Commit**

---

## Verification Checklist

After all tasks complete:

- [x] `npx expo start --android` boots without crashes
- [x] First launch shows ConnectScreen
- [x] Health check validates URL before accepting
- [x] Invalid URL shows error message
- [x] After connecting, Board tab shows card count from SSE
- [x] Tab navigation (Board, Search, Settings) works
- [x] Settings shows current backend URL, editable
- [x] App background → foreground reconnects SSE
- [x] `@kanban-code/shared` types resolve (ALL_COLUMNS, Link, enrichLink, etc.)
- [x] Kill backend → app shows disconnected state
- [x] Restart backend → SSE auto-reconnects
