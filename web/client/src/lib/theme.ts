/**
 * Theme system — auto / light / dark, matching Swift's AppearanceMode.
 * Uses CSS custom properties applied to document.documentElement.
 *
 * Swift source: Sources/KanbanCode/App.swift:194 (AppearanceMode enum)
 */

export type AppearanceMode = 'auto' | 'light' | 'dark';

export function getNextMode(current: AppearanceMode): AppearanceMode {
  switch (current) {
    case 'dark': return 'light';
    case 'light': return 'dark';
    case 'auto': return 'dark';
  }
}

export function getModeIcon(mode: AppearanceMode): string {
  switch (mode) {
    case 'auto': return '◐';  // half circle
    case 'light': return '☀';  // sun
    case 'dark': return '☾';   // moon
  }
}

export function getModeLabel(mode: AppearanceMode): string {
  switch (mode) {
    case 'auto': return 'System';
    case 'light': return 'Light';
    case 'dark': return 'Dark';
  }
}

const darkTheme = {
  // Dark theme — Midnight Sapphire
  '--bg-primary': '#0C0E14',
  '--bg-secondary': '#161922',
  '--bg-tertiary': '#1E222E',
  '--bg-card': 'rgba(255,255,255,0.03)',
  '--bg-card-selected': 'rgba(59, 130, 246, 0.14)',
  '--bg-card-hover': 'rgba(255,255,255,0.05)',
  '--bg-toolbar': 'rgba(12, 14, 20, 0.92)',
  '--bg-input': 'rgba(255,255,255,0.05)',
  '--border-primary': 'rgba(255,255,255,0.06)',
  '--border-secondary': 'rgba(255,255,255,0.06)',
  '--border-card': 'rgba(255,255,255,0.04)',
  '--text-primary': '#E8EAF0',
  '--text-secondary': '#8B8FA3',
  '--text-tertiary': '#565B6E',
  '--accent': '#3B82F6',
  '--accent-hover': '#2563EB',
  '--danger': '#EF4444',
  '--success': '#22C55E',
  '--warning': '#F59E0B',
  '--column-header-bg': 'rgba(255,255,255,0.025)',
  '--menu-bg': 'rgba(22, 25, 34, 0.95)',
  '--menu-border': 'rgba(255,255,255,0.10)',
  '--menu-hover': 'rgba(255,255,255,0.06)',
  '--badge-bg': 'rgba(255,255,255,0.06)',
  '--terminal-bg': '#121212',
  // Aliases used by components
  '--color-secondary': '#8B8FA3',
  '--color-tertiary': '#565B6E',
  '--color-accent': '#3B82F6',
  '--text-primary-fallback': '#E8EAF0',
};

// Light theme based on "One Double Light" iTerm2 color scheme
// Source: https://github.com/mbadolato/iTerm2-Color-Schemes/blob/master/schemes/One%20Double%20Light.itermcolors
const lightTheme: Record<string, string> = {
  '--bg-primary': '#F7F7FA',           // Background Color
  '--bg-secondary': '#FFFFFF',
  '--bg-tertiary': '#E8E8ED',
  '--bg-card': 'rgba(56, 58, 66, 0.04)',
  '--bg-card-selected': 'rgba(1, 132, 188, 0.10)',  // Ansi 4 Blue tint
  '--bg-card-hover': 'rgba(56, 58, 66, 0.06)',
  '--bg-toolbar': 'rgba(247, 247, 250, 0.95)',
  '--bg-input': 'rgba(56, 58, 66, 0.05)',
  '--border-primary': '#D4D4DC',
  '--border-secondary': 'rgba(56, 58, 66, 0.10)',
  '--border-card': 'rgba(56, 58, 66, 0.08)',
  '--text-primary': '#383A42',         // Foreground Color
  '--text-secondary': '#696C77',
  '--text-tertiary': '#9DA0A8',
  '--accent': '#0184BC',              // Ansi 4 Blue
  '--accent-hover': '#016A96',
  '--danger': '#E45649',              // Ansi 1 Red
  '--success': '#50A14F',             // Ansi 2 Green
  '--warning': '#C18401',             // Ansi 3 Yellow
  '--column-header-bg': 'rgba(56, 58, 66, 0.04)',
  '--menu-bg': '#FFFFFF',
  '--menu-border': 'rgba(56, 58, 66, 0.15)',
  '--menu-hover': 'rgba(0,0,0,0.05)',
  '--badge-bg': 'rgba(0,0,0,0.06)',
  '--terminal-bg': '#FAFAFA',
  // Aliases used by components
  '--color-secondary': '#696C77',
  '--color-tertiary': '#9DA0A8',
  '--color-accent': '#0184BC',
  '--text-primary-fallback': '#383A42',
};

/** Apply theme CSS variables to the document root. */
export function applyTheme(mode: AppearanceMode): void {
  const isDark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const vars = isDark ? darkTheme : lightTheme;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
  root.setAttribute('data-theme', isDark ? 'dark' : 'light');
}
