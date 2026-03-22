import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { TerminalWS } from '../lib/ws-manager.js';

/**
 * React hook for xterm.js terminal with WebSocket backend.
 *
 * Spec: Section 4.7 (Terminal Rendering)
 * Swift equivalent: Sources/KanbanCode/TerminalRepresentable.swift (BatchedTerminalView + TerminalCache)
 */

// ANSI color palette matching native SwiftTerm config
const DARK_THEME = {
  background: '#121212',
  foreground: '#EBEBEB',
  cursor: '#00FF00',
  cursorAccent: '#121212',
  selectionBackground: '#4f8ef740',
  black: '#333333',
  red: '#FF5F56',
  green: '#5AF78E',
  yellow: '#FFD75F',
  blue: '#57ACFF',
  magenta: '#FF6AC1',
  cyan: '#5AF7D4',
  white: '#E0E0E0',
  brightBlack: '#666666',
  brightRed: '#FF6E67',
  brightGreen: '#5AF78E',
  brightYellow: '#FFFC67',
  brightBlue: '#6BC1FF',
  brightMagenta: '#FF77D0',
  brightCyan: '#5AF7D4',
  brightWhite: '#FFFFFF',
};

// Light theme based on One Double Light iTerm2 color scheme
const LIGHT_THEME = {
  background: '#FAFAFA',
  foreground: '#383A42',
  cursor: '#526FFF',
  cursorAccent: '#FAFAFA',
  selectionBackground: '#0184BC30',
  black: '#383A42',
  red: '#E45649',
  green: '#50A14F',
  yellow: '#C18401',
  blue: '#0184BC',
  magenta: '#A626A4',
  cyan: '#0997B3',
  white: '#FAFAFA',
  brightBlack: '#696C77',
  brightRed: '#E06C75',
  brightGreen: '#98C379',
  brightYellow: '#E5C07B',
  brightBlue: '#61AFEF',
  brightMagenta: '#C678DD',
  brightCyan: '#56B6C2',
  brightWhite: '#FFFFFF',
};

function getTerminalTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  return isDark ? DARK_THEME : LIGHT_THEME;
}

interface UseTerminalOptions {
  sessionName: string;
  fontSize?: number;
  onExit?: (code: number) => void;
}

export function useTerminal(containerRef: React.RefObject<HTMLDivElement | null>, options: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<TerminalWS | null>(null);

  const { sessionName, fontSize = 12, onExit } = options;

  // Fit terminal to container
  const doFit = useCallback(() => {
    if (fitRef.current && termRef.current) {
      try {
        fitRef.current.fit();
        const dims = fitRef.current.proposeDimensions();
        if (dims && wsRef.current?.isConnected) {
          wsRef.current.resize(dims.cols, dims.rows);
        }
      } catch {
        // Terminal not visible yet
      }
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionName) return;

    // Create terminal
    const term = new Terminal({
      fontFamily: "'SF Mono', 'Menlo', 'Consolas', 'Courier New', monospace",
      fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: getTerminalTheme(),
      scrollback: 10000,
      allowProposedApi: true,
      altClickMovesCursor: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Note: WebLinksAddon and CanvasAddon removed — they crash on rapid
    // card switching due to internal xterm render loop accessing disposed state.
    // FitAddon is sufficient. URLs are visible but not clickable.
    let disposed = false;
    termRef.current = term;
    fitRef.current = fitAddon;

    // Shift+Enter → \x0a instead of \x0d (spec Section 4.6)
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey) {
        wsRef.current?.send('\x0a');
        return false; // Prevent default
      }
      return true; // Allow all other keys
    });

    // Terminal mouse mode: 'browser' = drag-to-select + manual scroll,
    // 'tmux' = native tmux mouse tracking (shift+drag for selection).
    const mouseMode = localStorage.getItem('terminalMouseMode') ?? 'browser';
    const scrollSpeed = Number(localStorage.getItem('terminalScrollSpeed')) || 3;

    let blockMouseTracking: { dispose(): void } | null = null;
    let handleWheel: ((e: WheelEvent) => void) | null = null;

    if (mouseMode === 'browser') {
      // Block mouse tracking escape sequences from tmux so xterm.js handles
      // all mouse events locally (browser-like drag-to-select).
      const MOUSE_MODES = new Set([9, 1000, 1002, 1003, 1006]);
      blockMouseTracking = term.parser.registerCsiHandler(
        { prefix: '?', final: 'h' },
        (params) => {
          for (const p of params) {
            if (MOUSE_MODES.has(Array.isArray(p) ? p[0] : p)) return true;
          }
          return false;
        },
      );

      // Manually send SGR mouse scroll reports to the PTY so tmux still scrolls.
      handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!wsRef.current?.isConnected) return;
        const button = e.deltaY < 0 ? 64 : 65;
        const ticks = Math.max(1, Math.min(10, Math.round(Math.abs(e.deltaY) * scrollSpeed / 200)));
        for (let i = 0; i < ticks; i++) {
          wsRef.current.send(`\x1b[<${button};1;1M`);
        }
      };
      container.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    }

    // Custom right-click context menu for Copy / Paste
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Remove any existing menu
      document.getElementById('term-ctx-menu')?.remove();

      const selection = term.getSelection();

      const menu = document.createElement('div');
      menu.id = 'term-ctx-menu';
      Object.assign(menu.style, {
        position: 'fixed', zIndex: '10000',
        left: `${e.clientX}px`, top: `${e.clientY}px`,
        background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '6px', padding: '4px 0', minWidth: '160px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: '13px', color: '#e0e0e0',
      });

      const addItem = (label: string, shortcut: string, action: () => void, disabled = false) => {
        const item = document.createElement('div');
        Object.assign(item.style, {
          padding: '6px 12px', cursor: disabled ? 'default' : 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          opacity: disabled ? '0.4' : '1',
        });
        item.innerHTML = `<span>${label}</span><span style="font-size:11px;color:#888;margin-left:16px">${shortcut}</span>`;
        if (!disabled) {
          item.addEventListener('mouseenter', () => { item.style.backgroundColor = 'rgba(255,255,255,0.1)'; });
          item.addEventListener('mouseleave', () => { item.style.backgroundColor = 'transparent'; });
          item.addEventListener('click', () => { action(); menu.remove(); });
        }
        menu.appendChild(item);
      };

      addItem('Copy', '\u21E7\u2318C', () => {
        if (selection) navigator.clipboard.writeText(selection);
      }, !selection);

      addItem('Paste', '\u21E7\u2318V', async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text && wsRef.current?.isConnected) wsRef.current.send(text);
        } catch { /* clipboard permission denied */ }
      });

      // Separator
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;margin:4px 8px;background:rgba(255,255,255,0.1)';
      menu.appendChild(sep);

      addItem('Select All', '\u2318A', () => { term.selectAll(); });

      document.body.appendChild(menu);

      // Ensure menu stays within viewport
      requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
        if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
      });

      const closeMenu = (ev: Event) => {
        if (ev.target !== menu && !menu.contains(ev.target as Node)) {
          menu.remove();
          document.removeEventListener('mousedown', closeMenu, true);
        }
      };
      setTimeout(() => document.addEventListener('mousedown', closeMenu, true), 0);
    };
    container.addEventListener('contextmenu', handleContextMenu);

    // Initial fit
    setTimeout(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    }, 100);

    // Connect WebSocket
    term.writeln('\x1b[90mConnecting to terminal...\x1b[0m');
    term.writeln('\x1b[90m(If this hangs, node-pty may need rebuilding for your Node version)\x1b[0m');
    let connected = false;
    const ws = new TerminalWS({
      onData: (data) => {
        if (!connected) {
          connected = true;
          term.clear(); // Clear "Connecting..." once data arrives
          // Fit + send resize now that WS is connected — the initial fit ran
          // before connect so the PTY is still at the default 80x24.
          setTimeout(() => doFit(), 50);
        }
        term.write(data);
      },
      onExit: (code) => {
        term.writeln(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m`);
        onExit?.(code);
      },
      onClose: () => {
        if (!connected) {
          term.writeln('\x1b[33m[Session not available — tmux session may have ended]\x1b[0m');
        }
      },
      onError: () => {
        term.writeln('\r\n\x1b[31m[Connection error]\x1b[0m');
      },
    });
    ws.connect(sessionName);
    wsRef.current = ws;

    // Terminal input → WebSocket
    term.onData((data) => ws.send(data));

    // Resize observer — debounced to avoid excessive reflows during drag resize
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFit = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => doFit(), 50);
    };
    const observer = new ResizeObserver(debouncedFit);
    observer.observe(container);
    // Also observe the parent (catches side panel resize via flex)
    if (container.parentElement) observer.observe(container.parentElement);
    // Window resize fallback
    window.addEventListener('resize', debouncedFit);

    // Watch for theme changes and update terminal colors live
    const themeObserver = new MutationObserver(() => {
      const newTheme = getTerminalTheme();
      term.options.theme = newTheme;
      container.style.background = newTheme.background;
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Cleanup — set disposed flag to prevent deferred addon loading
    return () => {
      disposed = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', debouncedFit);
      themeObserver.disconnect();
      blockMouseTracking?.dispose();
      if (handleWheel) container.removeEventListener('wheel', handleWheel, { capture: true } as EventListenerOptions);
      container.removeEventListener('contextmenu', handleContextMenu);
      document.getElementById('term-ctx-menu')?.remove();
      observer.disconnect();
      ws.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  // Only re-create terminal when sessionName changes — NOT on callback/fontSize changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionName]);

  return { terminal: termRef, fit: doFit };
}
