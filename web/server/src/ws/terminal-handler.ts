import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import type { IncomingMessage } from 'http';
import type { TerminalClientMessage } from '@kanban-code/shared';
import { findExecutable } from '../infrastructure/shell-command.js';
import { info, error as logError } from '../infrastructure/logger.js';

/**
 * Terminal WebSocket handler — one WS per terminal tab.
 * Binary frames = terminal data, text frames = JSON control messages.
 *
 * Spec: Section 3.1 (Terminal WebSocket), Section 4 (Terminal Protocol)
 */

interface TerminalConnection {
  ptyProcess: pty.IPty;
  ws: WebSocket;
  sessionName: string;
}

const connections = new Map<string, TerminalConnection>();

/**
 * Handle a new WebSocket connection for terminal streaming.
 * URL pattern: /ws/terminal/:sessionName
 */
export function handleTerminalConnection(ws: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url ?? '', `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/').filter(Boolean);
  // Expected: ['ws', 'terminal', sessionName] — decode URI component (spaces etc.)
  const sessionName = decodeURIComponent(pathParts[2] ?? '');

  if (!sessionName) {
    ws.close(1008, 'Missing session name');
    return;
  }

  info('terminal-ws', `New connection for session: ${sessionName}`);

  const tmuxPath = findExecutable('tmux') ?? 'tmux';
  const userShell = process.env.SHELL ?? '/bin/zsh';
  info('terminal-ws', `tmux=${tmuxPath} shell=${userShell}`);

  // Spawn PTY running tmux attach with polling loop
  // Matches native TerminalRepresentable.swift:479 pattern exactly
  // Added: exit 1 if tmux session not found after polling (prevents zombie PTY)
  // Sanitize dots/colons to underscores — tmux does this internally
  const sanitized = sessionName.replace(/[.:]/g, '_');
  const escaped = sanitized.replace(/'/g, "'\\''");
  // Enable tmux mouse mode so scroll enters copy-mode (matches native SwiftTerm behavior)
  // Then attach to the session
  const attachCmd = `for i in $(seq 1 50); do '${tmuxPath}' has-session -t '${escaped}' 2>/dev/null && break; sleep 0.1; done; '${tmuxPath}' has-session -t '${escaped}' 2>/dev/null || { echo "tmux session '${escaped}' not found"; exit 1; }; '${tmuxPath}' set-option -t '${escaped}' mouse on 2>/dev/null; exec '${tmuxPath}' attach-session -t '${escaped}'`;
  info('terminal-ws', `attachCmd: ${attachCmd.substring(0, 120)}...`);

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(userShell, ['-l', '-c', attachCmd], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME ?? '/tmp',
      env: process.env as Record<string, string>,
    });
  } catch (err) {
    logError('terminal-ws', `Failed to spawn PTY for ${sessionName}: ${err}`);
    // Send error as text frame so client can display it, then close
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: `PTY spawn failed: ${err}` }));
      ws.close(1011, 'PTY spawn failed');
    }
    return;
  }

  const conn: TerminalConnection = { ptyProcess, ws, sessionName };
  connections.set(sessionName, conn);

  info('terminal-ws', `PTY spawned PID=${ptyProcess.pid} for ${sessionName}`);

  // PTY output → binary WS frames
  let dataCount = 0;
  ptyProcess.onData((data: string) => {
    dataCount++;
    if (dataCount <= 3) {
      info('terminal-ws', `PTY data #${dataCount} for ${sessionName}: ${data.length} bytes, preview=${JSON.stringify(data.substring(0, 80))}`);
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(Buffer.from(data, 'utf-8'), { binary: true });
    }
  });

  // PTY exit → notify client + cleanup
  ptyProcess.onExit(({ exitCode, signal }) => {
    info('terminal-ws', `PTY exited for ${sessionName}: code=${exitCode} signal=${signal} dataCount=${dataCount}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode, signal }));
      ws.close(1000, 'PTY exited');
    }
    connections.delete(sessionName);
  });

  // Client input → PTY
  // Binary frames = terminal keystrokes → write to PTY
  // Text frames = JSON control messages (resize) → parse and handle
  ws.on('message', (data: Buffer | string, isBinary: boolean) => {
    const str = data.toString();
    if (!isBinary && str.startsWith('{')) {
      // Text frame that looks like JSON → try to parse as control message
      try {
        const msg = JSON.parse(str) as TerminalClientMessage;
        if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          ptyProcess.resize(msg.cols, msg.rows);
          return;
        }
      } catch {
        // Not valid JSON — fall through to write to PTY
      }
    }
    // Everything else → terminal keystroke data
    ptyProcess.write(str);
  });

  // WS close → kill PTY (tmux client only, not server session)
  ws.on('close', () => {
    info('terminal-ws', `Connection closed for ${sessionName}`);
    try { ptyProcess.kill(); } catch { /* already dead */ }
    connections.delete(sessionName);
  });

  ws.on('error', (err) => {
    logError('terminal-ws', `WS error for ${sessionName}: ${err.message}`);
    try { ptyProcess.kill(); } catch { /* already dead */ }
    connections.delete(sessionName);
  });
}

/** Get active terminal connections count. */
export function getActiveConnections(): number {
  return connections.size;
}

/** Set up WebSocket server on an existing HTTP server. */
export function setupTerminalWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (ws, req) => {
    const url = req.url ?? '';
    if (url.startsWith('/ws/terminal/')) {
      handleTerminalConnection(ws, req);
    } else {
      ws.close(1008, 'Unknown WebSocket endpoint');
    }
  });
}
