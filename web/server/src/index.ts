import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { setupTerminalWebSocket } from './ws/terminal-handler.js';
import { addClient, sendEvent } from './sse/state-broadcaster.js';
import { authMiddleware, getOrCreateToken, isAuthRequired, validateWsToken } from './middleware/auth.js';
import { info } from './infrastructure/logger.js';
import { CoordinationStore } from './infrastructure/coordination-store.js';
import { SettingsStore } from './infrastructure/settings-store.js';
import { TmuxAdapter } from './adapters/tmux/tmux-adapter.js';
import { EffectHandler } from './usecases/effect-handler.js';
import { StoreManager } from './usecases/store-manager.js';
import { LaunchSession } from './usecases/launch-session.js';
import { createCardRoutes } from './routes/cards.js';
import { createSystemRoutes } from './routes/system.js';
import { GitWorktreeAdapter } from './adapters/git/worktree-adapter.js';
import { GhCliAdapter } from './adapters/git/gh-cli-adapter.js';
import { checkAll } from './infrastructure/dependency-checker.js';
import { CodingAssistantRegistry } from './usecases/coding-assistant-registry.js';
import { CompositeSessionDiscovery } from './usecases/composite-session-discovery.js';
import { CompositeActivityDetector } from './usecases/composite-activity-detector.js';
import { BackgroundOrchestrator } from './usecases/background-orchestrator.js';
import { HookEventStore } from './adapters/claude/hook-event-store.js';
import { loadPlugins } from './plugins/registry.js';
import { registerDescriptors, enrichLinks } from '@kanban-code/shared';

/**
 * Kanban Code Web Server — Express + WebSocket + SSE.
 *
 * Spec: Section 2 (Architecture), Section 2.5 (Security), Section 3 (Transport Layer)
 */

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

// Web app uses ~/.kanban-code-web to avoid conflicts with native macOS app (~/.kanban-code)
const KANBAN_BASE = process.env.KANBAN_BASE ?? path.join(os.homedir(), '.kanban-code-web');

// Initialize infrastructure with web-specific base path
const coordinationStore = new CoordinationStore(KANBAN_BASE);
const settingsStore = new SettingsStore(KANBAN_BASE);
const tmuxAdapter = new TmuxAdapter();

// Initialize adapters needed by both routes and orchestrator
const worktreeAdapter = new GitWorktreeAdapter();
const ghAdapter = new GhCliAdapter();

// Initialize state management
const effectHandler = new EffectHandler(coordinationStore, tmuxAdapter);
const store = new StoreManager(effectHandler);
const registry = new CodingAssistantRegistry();
let triggerReconciliation: (() => Promise<void>) | undefined;
let triggerSync: (() => Promise<void>) | undefined;

// Load existing links from disk + scan live tmux sessions to clear dead tmuxLinks
(async () => {
  try {
    const links = coordinationStore.readLinks();
    const linksMap: Record<string, any> = {};
    let cleaned = 0;
    for (const link of links) {
      // Skip test cards with non-existent temp directory projectPaths
      if (link.projectPath && link.projectPath.includes('/T/kanban-code-ops-test')) {
        cleaned++;
        continue;
      }
      linksMap[link.id] = link;
    }
    if (cleaned > 0) {
      info('server', `Filtered ${cleaned} test cards from links.json`);
      // Persist cleanup so they don't come back
      coordinationStore.writeLinks(Object.values(linksMap));
    }

    // Scan live tmux sessions so Phase D cleanup can clear dead tmuxLinks
    let liveTmuxNames: string[] = [];
    try {
      const tmuxSessions = await tmuxAdapter.listSessions();
      liveTmuxNames = tmuxSessions.map(s => s.name);
      info('server', `Found ${liveTmuxNames.length} live tmux sessions`);
    } catch {
      info('server', 'tmux not available — skipping session scan');
    }

    // --- Startup mode: fresh wipes all discovered cards ---
    const startupMode = process.env.KANBAN_STARTUP_MODE ?? 'clean';
    if (startupMode === 'fresh') {
      let wiped = 0;
      for (const [id, link] of Object.entries(linksMap)) {
        if (link.source === 'discovered') {
          delete linksMap[id];
          wiped++;
        }
      }
      if (wiped > 0) {
        info('server', `FRESH mode: wiped ${wiped} discovered cards (kept ${Object.keys(linksMap).length} manual/issue cards)`);
      }
    }

    // --- Stale cleanup: clear dead links, remove orphans ---
    let cleanupCount = 0;
    const orphanIds: string[] = [];
    for (const [id, link] of Object.entries(linksMap)) {
      // Clear tmuxLink if tmux session is dead
      if (link.tmuxLink?.sessionName && !liveTmuxNames.includes(link.tmuxLink.sessionName)) {
        const allNames = [link.tmuxLink.sessionName, ...(link.tmuxLink.extraSessions ?? [])];
        const anyAlive = allNames.some((n: string) => liveTmuxNames.includes(n));
        if (!anyAlive) {
          linksMap[id] = { ...linksMap[id], tmuxLink: null };
          cleanupCount++;
          info('server', `Cleared dead tmuxLink on card ${id.substring(0, 16)}`);
        }
      }

      // Clear sessionLink if the file doesn't exist on disk (skip kiro-sqlite:// URIs)
      if (link.sessionLink?.sessionPath && !link.sessionLink.sessionPath.startsWith('kiro-sqlite://')) {
        try {
          fs.statSync(link.sessionLink.sessionPath);
        } catch {
          linksMap[id] = { ...linksMap[id], sessionLink: null };
          cleanupCount++;
          info('server', `Cleared dead sessionLink on card ${id.substring(0, 16)}`);
        }
      }

      // Clear worktreeLink if path doesn't exist on disk
      if (linksMap[id]?.worktreeLink?.path) {
        try {
          fs.statSync(linksMap[id].worktreeLink.path);
        } catch {
          linksMap[id] = { ...linksMap[id], worktreeLink: null };
          cleanupCount++;
          info('server', `Cleared dead worktreeLink on card ${id.substring(0, 16)}`);
        }
      }

      // Clear stale isLaunching (no launch survives a restart)
      if (linksMap[id]?.isLaunching) {
        linksMap[id] = { ...linksMap[id], isLaunching: null };
        cleanupCount++;
      }

      // Mark orphan discovered cards for removal
      const l = linksMap[id];
      if (l && l.source === 'discovered' && !l.sessionLink && !l.tmuxLink && !l.worktreeLink && !l.issueLink && (!l.prLinks || l.prLinks.length === 0)) {
        orphanIds.push(id);
      }
    }

    // Remove orphan discovered cards
    for (const id of orphanIds) {
      delete linksMap[id];
      cleanupCount++;
    }
    if (orphanIds.length > 0) {
      info('server', `Removed ${orphanIds.length} orphan discovered cards`);
    }

    // Always persist cleaned links back to disk
    if (cleanupCount > 0 || cleaned > 0) {
      coordinationStore.writeLinks(Object.values(linksMap));
      info('server', `Startup cleanup: ${cleanupCount} fixes applied, ${Object.keys(linksMap).length} cards remain`);
    }

    // Load persisted deleted IDs BEFORE reconciling — prevents resurrection of deleted cards
    const deletedIds = coordinationStore.readDeletedIds();
    if (deletedIds.sessionIds.length > 0 || deletedIds.cardIds.length > 0) {
      store.dispatch({ type: 'loadDeletedIds', sessionIds: deletedIds.sessionIds, cardIds: deletedIds.cardIds });
      info('server', `Loaded ${deletedIds.sessionIds.length} deleted sessionIds, ${deletedIds.cardIds.length} deleted cardIds`);
    }

    if (Object.keys(linksMap).length > 0) {
      store.dispatch({ type: 'reconciled', result: { links: linksMap, tmuxSessions: liveTmuxNames } });
      info('server', `Loaded ${links.length} cards from disk`);
    }
  } catch (err) {
    info('server', `Failed to load cards: ${err}`);
  }

  // --- Register installed coding assistants via plugin system ---
  const pluginsDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'plugins');
  const descriptors = await loadPlugins(pluginsDir, registry);
  registerDescriptors(descriptors);
  info('server', `Loaded ${descriptors.length} assistant plugins: [${descriptors.map(d => d.id).join(', ')}]`);

  // --- Composite wrappers ---
  const compositeDiscovery = new CompositeSessionDiscovery(registry);
  const compositeDetector = new CompositeActivityDetector(registry);

  // --- Background Orchestrator ---
  const orchestrator = new BackgroundOrchestrator({
    discovery: compositeDiscovery,
    activityDetector: compositeDetector,
    coordinationStore,
    settingsStore,
    // Hook events are written by hook.sh to ~/.kanban-code/ (shared with native app)
    hookEventStore: new HookEventStore(path.join(os.homedir(), '.kanban-code')),
    tmux: tmuxAdapter,
    worktreeAdapter,
    prTracker: ghAdapter,
    notifier: null,
  });
  orchestrator.setDispatch((action) => store.dispatch(action as any));
  orchestrator.start();
  triggerReconciliation = () => orchestrator.triggerTick();
  triggerSync = () => orchestrator.triggerSync();
  info('server', 'BackgroundOrchestrator started (5s tick)');

  // Graceful shutdown
  const shutdown = () => {
    orchestrator.stop();
    info('server', 'BackgroundOrchestrator stopped');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})();

// Express app
const app = express();
app.use(express.json());
app.use(cors({
  origin: '*', // Allow all origins for mobile/remote access
}));

// Health check (unauthenticated, at both root and /api for consistency)
app.get(['/health', '/api/health'], async (_req, res) => {
  const status = await checkAll(settingsStore);
  res.json({ status: 'ok', version: '0.1.0', dependencies: status });
});

// Auth middleware (only enforced when KANBAN_AUTH=required)
app.use('/api', authMiddleware);


// GET /api/terminal-page — serves terminal HTML page for mobile WebView
// Reads the pre-built terminal.html (xterm.js inlined, no CDN) and serves it.
// The HTML reads wsUrl and fontSize from URL query params via URLSearchParams.
app.get('/api/terminal-page', (req, res) => {
  // Resolve relative to server src → server → web → project root → mobile
  const terminalHtmlPath = path.resolve(__dirname, '..', '..', '..', '..', 'mobile', 'public', 'terminal.html');
  try {
    const html = fs.readFileSync(terminalHtmlPath, 'utf-8');
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(html);
  } catch (err) {
    res.status(500).send('terminal.html not found: ' + String(err));
  }
});

// LEGACY: old terminal-page with CDN (replaced above)
app.get('/api/terminal-page-cdn', (req, res) => {
  const { wsUrl, fontSize = '14' } = req.query;
  if (!wsUrl || typeof wsUrl !== 'string') {
    res.status(400).send('wsUrl query param required');
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body,#t{width:100%;height:100%;background:#121212;overflow:hidden}
.xterm{height:100%}
</style>
</head>
<body>
<div id="t"></div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js"></script>
<script>
(function(){
  function log(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'log', text: msg}));
    }
  }
  var term = new Terminal({
    fontSize: ${parseInt(String(fontSize)) || 14},
    fontFamily: 'Menlo, Monaco, Courier New, monospace',
    theme: { background:'#121212', foreground:'#e5e5ea', cursor:'#00FF00' },
    scrollback: 5000, convertEol: true, cursorBlink: true,
  });
  var fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('t'));
  window.__term = term;
  window.__fitAddon = fitAddon;
  setTimeout(function(){ fitAddon.fit(); }, 200);

  var ws = null, intentionalClose = false, retryCount = 0;
  function connect() {
    ws = new WebSocket('${wsUrl}'.replace(/&amp;/g,'&'));
    ws.binaryType = 'arraybuffer';
    ws.onopen = function() {
      retryCount = 0;
      var dims = fitAddon.proposeDimensions();
      if (dims && ws.readyState === 1) ws.send(JSON.stringify({type:'resize',cols:dims.cols,rows:dims.rows}));
      log('connected');
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({type:'connected'}));
    };
    ws.onmessage = function(e) {
      if (e.data instanceof ArrayBuffer) { term.write(new Uint8Array(e.data)); }
      else { try { var m=JSON.parse(e.data); if(m.type==='exit'){intentionalClose=true;term.write('\\r\\n\\x1b[2m[Exited '+m.code+']\\x1b[0m\\r\\n');if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:'exit',code:m.code}));}else if(m.type==='error'){term.write('\\r\\n\\x1b[31m['+m.message+']\\x1b[0m\\r\\n');}}catch(x){} }
    };
    ws.onclose = function() {
      if (intentionalClose) return;
      if (retryCount < 5) { var d=1000*Math.pow(2,retryCount++); term.write('\\r\\n\\x1b[33m[Reconnecting...]\\x1b[0m\\r\\n'); setTimeout(connect,d); }
      else { term.write('\\r\\n\\x1b[31m[Disconnected]\\x1b[0m\\r\\n'); if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:'disconnected'})); }
    };
    ws.onerror = function(){};
  }
  term.onData(function(data){ if(ws&&ws.readyState===1)ws.send(new TextEncoder().encode(data)); });
  window.__sendResize = function(){ var d=fitAddon.proposeDimensions(); if(d&&ws&&ws.readyState===1)ws.send(JSON.stringify({type:'resize',cols:d.cols,rows:d.rows})); };
  window.addEventListener('resize',function(){ fitAddon.fit(); window.__sendResize(); });
  window.addEventListener('message',function(e){ try{var m=JSON.parse(e.data);if(m.type==='fit'){fitAddon.fit();window.__sendResize();}if(m.type==='key')term.input(m.key,false);}catch(x){} });
  document.addEventListener('message',function(e){ try{var m=JSON.parse(e.data);if(m.type==='fit'){fitAddon.fit();window.__sendResize();}if(m.type==='key')term.input(m.key,false);}catch(x){} });
  document.getElementById('t').addEventListener('click',function(){term.focus();});
  connect();
})();
</script>
</body>
</html>`);
});

// GET /api/state — full state snapshot with enriched links
app.get('/api/state', authMiddleware, (_req, res) => {
  const rawState = store.getState();
  const links = enrichLinks(rawState.links);
  res.json({ ...rawState, links });
});

// SSE endpoint — sends initial state snapshot on connect
app.get('/api/events', (req, res) => {
  const clientId = addClient(res);
  // Send initial state snapshot — enriched, wrapped in { state: ... } to match applyEvent shape
  const rawState = store.getSnapshot();
  const enrichedSnapshot = { ...rawState, links: enrichLinks(rawState.links) };
  sendEvent('state:snapshot', { state: enrichedSnapshot });
  info('server', `SSE client ${clientId} connected, sent snapshot`);
});

// REST API routes
const launcher = new LaunchSession(tmuxAdapter);
app.use('/api/cards', createCardRoutes(store, launcher, registry));

// System routes (tmux-sessions, worktrees, hooks, backlog)
app.use('/api', createSystemRoutes({
  settingsStore,
  tmuxAdapter,
  worktreeAdapter,
  ghAdapter,
  store,
  coordinationStore,
  triggerReconciliation: () => triggerReconciliation?.() ?? Promise.resolve(),
  triggerSync: () => triggerSync?.() ?? Promise.resolve(),
}));

// Settings routes (minimal for Phase 1)
app.get('/api/settings', (_req, res) => {
  res.json(settingsStore.read());
});

app.patch('/api/settings', (req, res) => {
  try {
    const current = settingsStore.read();
    const updated = { ...current, ...req.body };
    settingsStore.write(updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Projects routes — merge configured + auto-discovered, filter hidden
app.get('/api/projects', (_req, res) => {
  const settings = settingsStore.read();
  const configured = settings.projects ?? [];
  const hidden = new Set<string>(settings.globalView?.excludedPaths ?? []);
  const configuredPaths = new Set(configured.map((p: any) => p.path));
  // Auto-discover from cards
  const discovered: Array<{ path: string; name: string; visible: boolean }> = [];
  for (const link of Object.values(store.getState().links)) {
    if (link.projectPath && !configuredPaths.has(link.projectPath) && !hidden.has(link.projectPath)) {
      configuredPaths.add(link.projectPath);
      const name = link.projectPath.split('/').filter(Boolean).pop() ?? link.projectPath;
      discovered.push({ path: link.projectPath, name, visible: true });
    }
  }
  const all = [...configured, ...discovered].filter(p => !hidden.has(p.path));
  res.json({ projects: all.sort((a, b) => a.name.localeCompare(b.name)) });
});

// Hide a project (add to blocklist)
app.post('/api/projects/hide', (req, res) => {
  const { path: projectPath } = req.body;
  if (!projectPath) { res.status(400).json({ error: 'path required' }); return; }
  const settings = settingsStore.read();
  const hidden = new Set<string>(settings.globalView?.excludedPaths ?? []);
  hidden.add(projectPath);
  settingsStore.write({ ...settings, globalView: { ...settings.globalView, excludedPaths: [...hidden] } });
  res.json({ hidden: true, path: projectPath });
});

// Unhide a project (remove from blocklist)
app.post('/api/projects/unhide', (req, res) => {
  const { path: projectPath } = req.body;
  if (!projectPath) { res.status(400).json({ error: 'path required' }); return; }
  const settings = settingsStore.read();
  const hidden = new Set<string>(settings.globalView?.excludedPaths ?? []);
  hidden.delete(projectPath);
  settingsStore.write({ ...settings, globalView: { ...settings.globalView, excludedPaths: [...hidden] } });
  res.json({ hidden: false, path: projectPath });
});

// Create HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({
  server,
  verifyClient: (wsInfo, callback) => {
    const headers = wsInfo.req.headers as Record<string, string>;
    const url = wsInfo.req.url ?? '';
    if (validateWsToken(url, headers)) {
      callback(true);
    } else {
      callback(false, 401, 'Unauthorized');
    }
  },
});

setupTerminalWebSocket(wss);

// Start server
server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  info('server', `Kanban Code Web Server running at ${url}`);
  console.log(`\n  Kanban Code Web Server`);
  console.log(`  ${url}\n`);

  if (isAuthRequired()) {
    const token = getOrCreateToken();
    console.log(`  Auth required: ${url}?token=${token}\n`);
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Kill the existing process or use PORT=<other> env var.\n`);
  } else {
    console.error(`\n  Server error: ${err.message}\n`);
  }
  process.exit(1);
});

export { app, server, store };
