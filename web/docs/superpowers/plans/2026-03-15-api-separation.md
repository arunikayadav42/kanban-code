# API Separation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken features (queued prompts, column DnD, fork) + make backend consumable by React Native mobile app

**Architecture:** Vertical slices across shared types, server routes, and client components. Server-authoritative Elm-like state with SSE push. All async ops show immediate visual feedback via pendingOps store pattern.

**Tech Stack:** TypeScript, Express, React 18, Zustand, @dnd-kit/core 6.3.1, node-pty, xterm.js

**Spec:** `web/docs/superpowers/specs/2026-03-15-api-separation-design.md`

---

## Parallelization Strategy

Based on file-level conflict analysis (31 verification agents):

```
Wave 0: Shared Foundation ──── 1 agent  (types, helpers, colors)
         │
Wave 1: Server Backend ─────── 3 agents in parallel
         │  Agent A: cards.ts (all route changes)
         │  Agent B: board-store + store-manager + effect-handler
         │  Agent C: adapters + system.ts + index.ts
         │
Wave 2: Client Frontend ────── 2 agents in parallel
         │  Agent D: Store + API + TerminalTabs + CSS
         │  Agent E: All view components + App.tsx wiring
         │
Wave 3: Integration ─────────── 1 agent (build + test + verify)
```

**Why this structure:**
- Wave 0 must complete first: all server/client code imports from shared
- Wave 1 agents touch zero overlapping files (verified via line-level analysis)
- Wave 2 agents touch zero overlapping files (Agent D: store layer, Agent E: view layer)
- Wave 2 depends on Wave 1 (client calls server routes that must exist)
- No pre-build step needed — shared uses raw `.ts` source via tsx/vite

---

## Wave 0: Shared Foundation

### Task 0.1: Link computed fields + helpers

**Files:**
- Modify: `web/shared/src/types/link.ts`

- [x] **Step 1: Add optional computed fields to Link interface**
- [x] **Step 2: Add getProjectName helper**
- [x] **Step 3: Add getCardType helper**
- [x] **Step 4: Add enrichLink and enrichLinks**
- [x] **Step 5: Add validateColumnMove**
- [x] **Step 6: Write tests**
- [x] **Step 7: Run tests**
- [x] **Step 8: Commit**

### Task 0.2: Color constants

**Files:**
- Create: `web/shared/src/types/colors.ts`
- Modify: `web/shared/src/index.ts`

- [x] **Step 1: Create colors.ts**
- [x] **Step 2: Add export to index.ts**
- [x] **Step 3: Commit**

### Task 0.3: SSE payload types + REST response types + WS protocol types

**Files:**
- Modify: `web/shared/src/types/events.ts`
- Modify: `web/shared/src/types/api.ts`
- Create: `web/shared/src/types/terminal-protocol.ts`
- Modify: `web/shared/src/index.ts`

- [x] **Step 1: Add 11 SSE payload interfaces to events.ts**
- [x] **Step 2: Add REST types to api.ts**
- [x] **Step 3: Create terminal-protocol.ts**
- [x] **Step 4: Add terminal-protocol export to index.ts**
- [x] **Step 5: Commit**

---

## Wave 1: Server Backend (3 agents in parallel)

### Task 1A: All cards.ts route changes

**Files:**
- Modify: `web/server/src/routes/cards.ts`
- Test: `web/server/src/routes/__tests__/cards.test.ts`

**Agent A owns cards.ts exclusively. No other Wave 1 agent touches this file.**

- [x] **Step 1: Add 4 queued prompt routes**
- [x] **Step 2: Add column validation to PATCH handler**
- [x] **Step 3: Add fork route**
- [x] **Step 4: Add send-prompt route**
- [x] **Step 5: Write route tests**
- [x] **Step 6: Run tests, commit**

### Task 1B: board-store + store-manager + effect-handler

**Files:**
- Modify: `web/server/src/usecases/board-store.ts`
- Modify: `web/server/src/usecases/store-manager.ts`
- Modify: `web/server/src/usecases/effect-handler.ts`

**Agent B owns these 3 files exclusively.**

- [x] **Step 1: Fix effect type mismatch in board-store.ts**
- [x] **Step 2: Add sendDirectPrompt action type and reducer case**
- [x] **Step 3: Fix effect-handler.ts field name mismatch**
- [x] **Step 4: Add enrichLinks to store-manager.ts buildEventPayload**
- [x] **Step 5: Add ACTION_TO_SSE_EVENT entry for sendDirectPrompt**
- [x] **Step 6: Write tests, run, commit**

### Task 1C: Adapters + system.ts + index.ts

**Files:**
- Modify: `web/server/src/domain/ports/session-store.ts`
- Modify: `web/server/src/adapters/claude/session-store.ts`
- Modify: `web/server/src/adapters/gemini/session-store.ts`
- Modify: `web/server/src/adapters/kiro/session-store.ts`
- Modify: `web/server/src/routes/system.ts`
- Modify: `web/server/src/index.ts`
- Modify: `web/server/src/ws/terminal-handler.ts`
- Modify: `web/client/src/lib/ws-manager.ts`

**Agent C owns these files exclusively.**

- [x] **Step 1: Add resolveSessionPath to SessionStore port**
- [x] **Step 2: Implement in Claude adapter**
- [x] **Step 3: Implement in Gemini adapter**
- [x] **Step 4: Implement in Kiro adapter**
- [x] **Step 5: Add /api/assistants to system.ts**
- [x] **Step 6: Add /api/state to index.ts**
- [x] **Step 7: Import shared WS types in terminal-handler.ts**
- [x] **Step 8: Import shared WS types in ws-manager.ts**
- [x] **Step 9: Run tests, commit**

---

## Wave 2: Client Frontend (2 agents in parallel)

### Task 2D: Store + API + TerminalTabs + CSS

**Files:**
- Modify: `web/client/src/store/index.ts`
- Modify: `web/client/src/lib/api-client.ts`
- Modify: `web/client/src/components/TerminalTabs.tsx`
- Modify: `web/client/src/components/CardDetailView.tsx`
- Create/Modify: `web/client/src/styles/pending-overlay.css` (or inline in existing CSS)

**Agent D owns these files exclusively.**

- [x] **Step 1: Add pendingOps to Zustand store**
- [x] **Step 2: Simplify getCardsInColumn cardType filter**
- [x] **Step 3: Add 8 new methods to api-client.ts**
- [x] **Step 4: Wire queued prompt callbacks in TerminalTabs.tsx**
- [x] **Step 5: Wire callbacks through CardDetailView.tsx**
- [x] **Step 6: Add CSS overlay**
- [x] **Step 7: Run tests, commit**

### Task 2E: All view components + App.tsx wiring

**Files:**
- Modify: `web/client/src/components/App.tsx`
- Modify: `web/client/src/components/CardView.tsx`
- Modify: `web/client/src/components/CardDetailView.tsx` (only color changes — D owns callback wiring)
- Modify: `web/client/src/components/PRBadge.tsx`
- Modify: `web/client/src/components/BoardView.tsx`
- Modify: `web/client/src/components/DragAndDrop.tsx`
- Delete: `web/client/src/components/CardDropIntent.ts`
- Delete: `web/client/src/components/__tests__/CardDropIntent.test.ts`

**Agent E owns these files exclusively. CardDetailView color changes only (Agent D owns callback changes).**

- [x] **Step 1: Wire all callbacks in App.tsx**
- [x] **Step 2: CardView.tsx — computed fields + colors + overlay**
- [x] **Step 3: PRBadge.tsx — use shared colors**
- [x] **Step 4: CardDetailView.tsx — colors only**
- [x] **Step 5: BoardView.tsx + DragAndDrop.tsx — pass pendingOps**
- [x] **Step 6: Delete dead code**
- [x] **Step 7: Run tests, commit**

---

## Wave 3: Integration

### Task 3.1: Build + test + verify

- [x] **Step 1: Run full test suite**
- [x] **Step 2: Build verification**
- [x] **Step 3: Manual smoke test**
- [x] **Step 4: Final commit**
