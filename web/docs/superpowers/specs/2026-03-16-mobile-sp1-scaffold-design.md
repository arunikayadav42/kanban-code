# SP1: React Native Mobile App — Scaffold + Data Layer

**Date:** 2026-03-16
**Goal:** Expo RN project that boots on Android, connects to the Kanban Code backend, receives SSE state, and navigates between 3 tabs.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Expo (with dev-client) | All native modules work, easier setup, OTA updates |
| Navigation | Bottom Tabs + Stack | 3 tabs: Board, Search, Settings. Card detail pushes on stack. |
| State | Zustand (ported from web) | Same store shape, AsyncStorage for persistence |
| SSE | react-native-sse | Drop-in EventSource replacement |
| Shared types | @kanban-code/shared via Metro watchFolders | .js→.ts resolver in metro.config.js |

## Critical Gaps Addressed

| Gap | Solution |
|-----|----------|
| `localStorage` crashes RN at module load | Safe defaults + async `hydrateFromStorage()` |
| Relative `/api` URL crashes RN fetch | `getApiBase()` throws if backendUrl empty |
| `EventSource` global doesn't exist in RN | `import EventSource from 'react-native-sse'` |
| App.tsx fires API calls before hydration | Boot gate: hydrate → validate → then render |
| No first-launch connect screen | New `ConnectScreen` with URL input + health check |
| SSE dies on background, no reconnect | AppState listener → reconnect on foreground |
| `window.location` in ws-manager | Throw if no backendUrl |
| Binary WS frames arrive as base64 in RN | Add base64 decode branch in onmessage |
| Metro can't resolve .js→.ts | Custom resolveRequest in metro.config.js |

## Project Structure

```
mobile/                              ← new top-level directory
├── app.json                         ← Expo config (name, slug, Android package)
├── package.json                     ← dependencies
├── metro.config.js                  ← watchFolders + .js→.ts resolver
├── babel.config.js                  ← module-resolver for @kanban-code/shared
├── tsconfig.json                    ← paths alias
├── App.tsx                          ← Entry: GestureHandlerRootView + boot gate
├── src/
│   ├── boot/
│   │   └── BootGate.tsx             ← Hydrate → validate backendUrl → route
│   ├── store/
│   │   └── index.ts                 ← Ported from web: AsyncStorage, hydrateFromStorage, isHydrated
│   ├── lib/
│   │   ├── api-client.ts            ← Copied from web: getApiBase throws if empty
│   │   └── ws-manager.ts            ← Ported: no window.location, base64 binary, string send
│   ├── hooks/
│   │   └── useSSE.ts                ← Ported: react-native-sse + AppState reconnect
│   ├── navigation/
│   │   └── RootNavigator.tsx        ← BottomTabs(Board, Search, Settings) + Stack
│   └── screens/
│       ├── ConnectScreen.tsx         ← First-launch: URL input + health check + persist
│       ├── BoardScreen.tsx           ← Placeholder: "Connected, X cards" (SP2)
│       ├── CardDetailScreen.tsx      ← Placeholder (SP2)
│       ├── SearchScreen.tsx          ← Placeholder (SP5)
│       └── SettingsScreen.tsx        ← Backend URL field (functional), rest placeholder
```

## Boot Sequence

```
App.tsx
  └── <GestureHandlerRootView>
        └── <BootGate>
              │
              ├── Phase 1: AsyncStorage.getItem('backendUrl')
              │   → if empty → show <ConnectScreen>
              │   → if found → Phase 2
              │
              ├── Phase 2: fetch(`${url}/api/health`)
              │   → if fails → show <ConnectScreen> with error
              │   → if passes → Phase 3
              │
              ├── Phase 3: hydrateFromStorage()
              │   → populates store from AsyncStorage
              │   → set({ isHydrated: true })
              │
              └── Phase 4: <NavigationContainer>
                    └── <RootNavigator>
                          ├── BoardTab → BoardScreen (SSE starts here)
                          ├── SearchTab → SearchScreen
                          └── SettingsTab → SettingsScreen
```

No API call, SSE connection, or component render happens until backendUrl is validated and store is hydrated.

## File Details

### metro.config.js

```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const sharedDir = path.resolve(__dirname, '../web/shared');
const config = getDefaultConfig(__dirname);

config.watchFolders = [sharedDir];
config.resolver.sourceExts = ['ts', 'tsx', 'js', 'jsx', 'json'];

// Redirect .js imports → .ts files (shared package uses .js extensions)
const origResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('.js')) {
    const tsName = moduleName.slice(0, -3) + '.ts';
    try { return context.resolveRequest(context, tsName, platform); }
    catch (_) {
      try { return context.resolveRequest(context, tsName + 'x', platform); }
      catch (_) {}
    }
  }
  return origResolve
    ? origResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
```

### babel.config.js

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module-resolver', { alias: { '@kanban-code/shared': '../web/shared/src' } }],
      'react-native-reanimated/plugin',  // must be last
    ],
  };
};
```

### store/index.ts — Key Changes from Web

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
// ... same types from @kanban-code/shared

export const useBoardStore = create<BoardState>((set, get) => ({
  // Safe defaults (no localStorage reads at creation time)
  links: {},
  selectedCardId: null,
  selectedProjectPath: null,
  boardViewMode: 'kanban' as const,
  backendUrl: '',           // empty until hydrated
  isHydrated: false,        // NEW gate flag
  selectedAssistant: null,
  selectedCardType: 'all' as const,
  pendingOps: {},
  // ... rest identical to web

  // NEW: async hydration replacing sync localStorage reads
  hydrateFromStorage: async () => {
    const [backendUrl, projectPath, viewMode, assistant, cardType] = await Promise.all([
      AsyncStorage.getItem('backendUrl'),
      AsyncStorage.getItem('selectedProjectPath'),
      AsyncStorage.getItem('boardViewMode'),
      AsyncStorage.getItem('selectedAssistant'),
      AsyncStorage.getItem('selectedCardType'),
    ]);
    set({
      backendUrl: backendUrl ?? '',
      selectedProjectPath: projectPath ?? null,
      boardViewMode: (viewMode as 'kanban' | 'list') ?? 'kanban',
      selectedAssistant: assistant ?? null,
      selectedCardType: (cardType as any) ?? 'all',
      isHydrated: true,
    });
  },

  // Setters: fire-and-forget AsyncStorage (sync state update + async persist)
  setBackendUrl: (url) => {
    AsyncStorage.setItem('backendUrl', url);
    set({ backendUrl: url });
  },
  setSelectedProjectPath: (path) => {
    if (path) AsyncStorage.setItem('selectedProjectPath', path);
    else AsyncStorage.removeItem('selectedProjectPath');
    set({ selectedProjectPath: path });
  },
  // ... same pattern for all persisted setters
}));
```

### api-client.ts — Key Change

```ts
export function getApiBase(): string {
  const backendUrl = useBoardStore.getState().backendUrl;
  if (!backendUrl) {
    throw new Error('Backend URL not configured — call hydrateFromStorage first');
  }
  return `${backendUrl.replace(/\/$/, '')}/api`;
}
// ... rest identical to web (all 27 methods copy as-is)
```

### useSSE.ts — Key Changes

```ts
import EventSource from 'react-native-sse';  // polyfill
import { AppState, type AppStateStatus } from 'react-native';
import { useEffect, useRef, useState } from 'react';

export function useSSE(handlers: SSEHandlers) {
  const backendUrl = useBoardStore(s => s.backendUrl);
  const [reconnectKey, setReconnectKey] = useState(0);

  // Foreground reconnect
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') setReconnectKey(k => k + 1);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!backendUrl) return;  // don't connect without URL
    const sseUrl = `${backendUrl.replace(/\/$/, '')}/api/events`;
    const es = new EventSource(sseUrl);
    // ... rest identical to web (addEventListener loop, onmessage, cleanup)
    return () => es.close();
  }, [backendUrl, reconnectKey]);  // reconnectKey forces reconnect on foreground
}
```

### ws-manager.ts — Key Changes

```ts
// getWsUrl: remove window.location fallback
private getWsUrl(sessionName: string): string {
  const backendUrl = useBoardStore.getState().backendUrl;
  if (!backendUrl) throw new Error('Backend URL not configured');
  const url = new URL(backendUrl);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${url.host}/ws/terminal/${encodeURIComponent(sessionName)}`;
}

// onmessage: add base64 binary handler
this.ws.onmessage = (event) => {
  if (event.data instanceof ArrayBuffer) {
    this.callbacks.onData(new Uint8Array(event.data));
  } else if (typeof event.data === 'string' && event.data.startsWith('base64,')) {
    const b64 = event.data.slice(7);
    const binary = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    this.callbacks.onData(binary);
  } else {
    // JSON control message (exit, error)
    // ... same as web
  }
};

// send: string instead of Uint8Array
send(data: string): void {
  if (this.ws?.readyState === WebSocket.OPEN) {
    this.ws.send(data);  // string, not TextEncoder
  }
}
```

### ConnectScreen.tsx

```tsx
// First-launch screen — shown when no backendUrl is configured
export default function ConnectScreen({ onConnected }: { onConnected: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    setError('');
    try {
      const base = url.replace(/\/$/, '');
      const res = await fetch(`${base}/api/health`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      await AsyncStorage.setItem('backendUrl', base);
      useBoardStore.getState().setBackendUrl(base);
      onConnected();
    } catch (err) {
      setError(`Cannot connect: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connect to Kanban Code</Text>
      <TextInput
        value={url}
        onChangeText={setUrl}
        placeholder="http://192.168.1.5:3000"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title={loading ? 'Connecting...' : 'Connect'} onPress={handleConnect} disabled={!url || loading} />
    </View>
  );
}
```

## Dependencies

```json
{
  "expo": "~52.0.0",
  "react": "18.3.1",
  "react-native": "0.76.7",
  "zustand": "^5.0.0",
  "@react-native-async-storage/async-storage": "^2.1.0",
  "react-native-sse": "^1.2.0",
  "@react-navigation/native": "^7.0.0",
  "@react-navigation/bottom-tabs": "^7.0.0",
  "@react-navigation/native-stack": "^7.0.0",
  "react-native-screens": "~4.4.0",
  "react-native-safe-area-context": "^5.0.0",
  "react-native-gesture-handler": "~2.20.0",
  "react-native-reanimated": "~3.16.0",
  "babel-plugin-module-resolver": "^5.0.0"
}
```

## What SP1 Delivers (Testable)

1. `npx expo start` boots on Android emulator
2. ConnectScreen appears on first launch — enter backend URL → health check passes → persisted
3. Board tab shows "Connected — X cards loaded" (placeholder, card rendering is SP2)
4. SSE stream connects → store.links populates with enriched cards
5. Tab navigation works (Board, Search, Settings)
6. Settings tab shows backend URL field (editable, takes effect immediately)
7. App backgrounded → foregrounded → SSE reconnects automatically
8. `@kanban-code/shared` types resolve correctly (enrichLink, validateColumnMove, etc.)

## Verification

```bash
cd mobile
npx expo start --android    # boots on emulator
# Enter http://10.0.2.2:3000 (Android emulator → host machine)
# Board tab shows card count
# Background app → foreground → SSE reconnects
# Change backend URL in Settings → SSE reconnects to new backend
```
