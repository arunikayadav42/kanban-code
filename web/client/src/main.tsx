import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './components/App.js';
import { getApiBase } from './lib/api-client.js';
import '@xterm/xterm/css/xterm.css';
import './styles/kanban.css';

/**
 * Kanban Code Web -- entry point.
 */

// Global error handler — sends ALL errors to server log
window.addEventListener('error', (e) => {
  const msg = `GLOBAL_ERROR: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`;
  console.error(msg);
  fetch(`${getApiBase()}/debug?msg=${encodeURIComponent(msg)}`).catch(() => {});
  // Show error on screen
  showErrorOverlay(msg);
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = `UNHANDLED_REJECTION: ${String(e.reason)}`;
  console.error(msg);
  fetch(`${getApiBase()}/debug?msg=${encodeURIComponent(msg)}`).catch(() => {});
  showErrorOverlay(msg);
});

function showErrorOverlay(msg: string) {
  let overlay = document.getElementById('error-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'error-overlay';
    overlay.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#1a0000;color:#ff6b6b;padding:12px 16px;font:12px/1.5 monospace;max-height:30vh;overflow:auto;border-top:2px solid #ff3333;';
    document.body.appendChild(overlay);
  }
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  overlay.appendChild(line);
  // Auto-scroll
  overlay.scrollTop = overlay.scrollHeight;
}

// Top-level error boundary
class TopErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const msg = `REACT_CRASH: ${error.message}\n${(info.componentStack ?? '').slice(0, 500)}`;
    console.error(msg);
    fetch(`${getApiBase()}/debug?msg=${encodeURIComponent(msg)}`).catch(() => {});
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#ff6b6b', fontFamily: 'monospace', background: '#0a0a0c', minHeight: '100vh' }}>
          <h2>App crashed</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#888', marginTop: 16 }}>{this.state.error.stack}</pre>
          <button onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ marginTop: 20, padding: '8px 16px', background: '#333', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// matchMedia polyfill for theme system
if (!window.matchMedia) {
  (window as any).matchMedia = () => ({ matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {} });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <TopErrorBoundary>
    <App />
  </TopErrorBoundary>
);
