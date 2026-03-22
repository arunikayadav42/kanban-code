import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { HookManager } from '../hook-manager.js';

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `kanban-code-hooks-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('HookManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it('installs hooks into empty settings', () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    const scriptPath = path.join(tempDir, '.kanban-code', 'hook.sh');
    fs.writeFileSync(settingsPath, '{}');

    HookManager.install({ assistant: 'claude', settingsPath, hookScriptPath: scriptPath });

    expect(HookManager.isInstalled({ assistant: 'claude', settingsPath })).toBe(true);

    // Verify all hook events are present
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hooks = data.hooks;
    expect(hooks.Stop).toBeDefined();
    expect(hooks.Notification).toBeDefined();
    expect(hooks.UserPromptSubmit).toBeDefined();
    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.SessionEnd).toBeDefined();

    // Verify nested format: [{matcher: "", hooks: [{type, command}]}]
    const stopGroups = hooks.Stop;
    expect(stopGroups).toHaveLength(1);
    const entries = stopGroups[0].hooks;
    expect(entries).toHaveLength(1);
    expect(entries[0].command).toContain('.kanban-code/hook.sh');

    // Verify hook script was deployed
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    // Check executable bit (owner execute)
    expect(stats.mode & 0o111).toBeGreaterThan(0);
  });

  it('preserves existing hooks in nested format', () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    const scriptPath = path.join(tempDir, '.kanban-code', 'hook.sh');
    const existing = JSON.stringify({
      hooks: {
        Stop: [
          {
            matcher: '',
            hooks: [
              { type: 'command', command: '/usr/local/bin/other-hook.sh' },
            ],
          },
        ],
      },
    });
    fs.writeFileSync(settingsPath, existing);

    HookManager.install({ assistant: 'claude', settingsPath, hookScriptPath: scriptPath });

    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hooks = data.hooks;
    const stopGroups = hooks.Stop;

    // Should have one group with both hooks
    expect(stopGroups).toHaveLength(1);
    const entries = stopGroups[0].hooks;
    expect(entries).toHaveLength(2);
  });

  it('install is idempotent (no duplicate entries)', () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    const scriptPath = path.join(tempDir, '.kanban-code', 'hook.sh');
    fs.writeFileSync(settingsPath, '{}');

    HookManager.install({ assistant: 'claude', settingsPath, hookScriptPath: scriptPath });
    HookManager.install({ assistant: 'claude', settingsPath, hookScriptPath: scriptPath });

    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hooks = data.hooks;
    const stopGroups = hooks.Stop;
    const entries = stopGroups[0].hooks;

    // Should NOT have duplicates
    expect(entries).toHaveLength(1);
  });

  it('uninstall removes only kanban hooks', () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    const existing = JSON.stringify({
      hooks: {
        Stop: [
          {
            matcher: '',
            hooks: [
              { type: 'command', command: '/usr/local/bin/other-hook.sh' },
              { type: 'command', command: '/home/user/.kanban-code/hook.sh' },
            ],
          },
        ],
      },
    });
    fs.writeFileSync(settingsPath, existing);

    HookManager.uninstall({ assistant: 'claude', settingsPath });

    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hooks = data.hooks;
    const stopGroups = hooks.Stop;
    const entries = stopGroups[0].hooks;

    expect(entries).toHaveLength(1);
    expect(entries[0].command).toContain('other-hook');
  });

  it('isInstalled returns false for missing settings', () => {
    expect(HookManager.isInstalled({ assistant: 'claude', settingsPath: '/nonexistent/path' })).toBe(false);
  });

  it('install creates settings file if missing', () => {
    const settingsPath = path.join(tempDir, 'subdir', 'settings.json');
    const scriptPath = path.join(tempDir, '.kanban-code', 'hook.sh');

    HookManager.install({ assistant: 'claude', settingsPath, hookScriptPath: scriptPath });

    expect(fs.existsSync(settingsPath)).toBe(true);
    expect(HookManager.isInstalled({ assistant: 'claude', settingsPath })).toBe(true);
  });

  it('install deploys executable hook script', () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    const scriptPath = path.join(tempDir, '.kanban-code', 'hook.sh');
    fs.writeFileSync(settingsPath, '{}');

    HookManager.install({ assistant: 'claude', settingsPath, hookScriptPath: scriptPath });

    // Script should exist
    expect(fs.existsSync(scriptPath)).toBe(true);

    // Script should be executable
    const stats = fs.statSync(scriptPath);
    expect(stats.mode & 0o111).toBeGreaterThan(0);

    // Script should contain shebang and event writing logic
    const content = fs.readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('#!/usr/bin/env bash');
    expect(content).toContain('hook-events.jsonl');
    expect(content).toContain('session_id');
  });

  // MARK: - Multi-Assistant Support

  it('install for Gemini uses correct event names', () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    const scriptPath = path.join(tempDir, '.kanban-code', 'hook.sh');
    fs.writeFileSync(settingsPath, '{}');

    HookManager.install({ assistant: 'gemini', settingsPath, hookScriptPath: scriptPath });

    expect(HookManager.isInstalled({ assistant: 'gemini', settingsPath })).toBe(true);

    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hooks = data.hooks;

    // Gemini uses different event names
    expect(hooks.AfterAgent).toBeDefined();
    expect(hooks.BeforeAgent).toBeDefined();
    expect(hooks.Notification).toBeDefined();
    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.SessionEnd).toBeDefined();

    // Should NOT have Claude-specific events
    expect(hooks.Stop).toBeUndefined();
    expect(hooks.UserPromptSubmit).toBeUndefined();
  });

  it('isInstalled for Gemini checks Gemini event names', () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    const scriptPath = path.join(tempDir, '.kanban-code', 'hook.sh');
    fs.writeFileSync(settingsPath, '{}');

    // Install Claude hooks
    HookManager.install({ assistant: 'claude', settingsPath, hookScriptPath: scriptPath });

    // Claude hooks installed but Gemini hooks are not
    expect(HookManager.isInstalled({ assistant: 'claude', settingsPath })).toBe(true);
    expect(HookManager.isInstalled({ assistant: 'gemini', settingsPath })).toBe(false);
  });

  it('uninstall for Gemini removes hooks from its own settings', () => {
    const claudeSettings = path.join(tempDir, 'claude-settings.json');
    const geminiSettings = path.join(tempDir, 'gemini-settings.json');
    const scriptPath = path.join(tempDir, '.kanban-code', 'hook.sh');
    fs.writeFileSync(claudeSettings, '{}');
    fs.writeFileSync(geminiSettings, '{}');

    HookManager.install({ assistant: 'claude', settingsPath: claudeSettings, hookScriptPath: scriptPath });
    HookManager.install({ assistant: 'gemini', settingsPath: geminiSettings, hookScriptPath: scriptPath });

    expect(HookManager.isInstalled({ assistant: 'claude', settingsPath: claudeSettings })).toBe(true);
    expect(HookManager.isInstalled({ assistant: 'gemini', settingsPath: geminiSettings })).toBe(true);

    // Uninstall Gemini only
    HookManager.uninstall({ assistant: 'gemini', settingsPath: geminiSettings });

    // Claude unaffected, Gemini removed
    expect(HookManager.isInstalled({ assistant: 'claude', settingsPath: claudeSettings })).toBe(true);
    expect(HookManager.isInstalled({ assistant: 'gemini', settingsPath: geminiSettings })).toBe(false);
  });

  it('normalizeEventName maps Gemini events to canonical names', () => {
    expect(HookManager.normalizeEventName('AfterAgent')).toBe('Stop');
    expect(HookManager.normalizeEventName('BeforeAgent')).toBe('UserPromptSubmit');
    expect(HookManager.normalizeEventName('SessionStart')).toBe('SessionStart');
    expect(HookManager.normalizeEventName('SessionEnd')).toBe('SessionEnd');
    expect(HookManager.normalizeEventName('Notification')).toBe('Notification');
    expect(HookManager.normalizeEventName('Stop')).toBe('Stop');
  });

  it('normalizeEventName maps Kiro events to canonical names', () => {
    expect(HookManager.normalizeEventName('agentSpawn')).toBe('SessionStart');
    expect(HookManager.normalizeEventName('stop')).toBe('Stop');
    expect(HookManager.normalizeEventName('userPromptSubmit')).toBe('UserPromptSubmit');
  });

  it('requiredHooks returns correct events per assistant', () => {
    const claude = HookManager.requiredHooks('claude');
    expect(claude).toContain('Stop');
    expect(claude).toContain('UserPromptSubmit');
    expect(claude).not.toContain('AfterAgent');

    const gemini = HookManager.requiredHooks('gemini');
    expect(gemini).toContain('AfterAgent');
    expect(gemini).toContain('BeforeAgent');
    expect(gemini).not.toContain('Stop');
    expect(gemini).not.toContain('UserPromptSubmit');

    const kiro = HookManager.requiredHooks('kiro');
    expect(kiro).toContain('stop');
    expect(kiro).toContain('userPromptSubmit');
    expect(kiro).toContain('agentSpawn');
    expect(kiro).not.toContain('Stop');
    expect(kiro).not.toContain('AfterAgent');
  });

  it('uninstall is safe on nonexistent file', () => {
    // Should not throw
    HookManager.uninstall({ assistant: 'claude', settingsPath: '/nonexistent/path' });
  });

  // MARK: - Kiro CLI Support

  it('install for Kiro uses simpler hook format (no matcher/type)', () => {
    const settingsPath = path.join(tempDir, 'default.json');
    const scriptPath = path.join(tempDir, '.kanban-code', 'hook.sh');
    fs.writeFileSync(settingsPath, '{}');

    HookManager.install({ assistant: 'kiro', settingsPath, hookScriptPath: scriptPath });

    expect(HookManager.isInstalled({ assistant: 'kiro', settingsPath })).toBe(true);

    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hooks = data.hooks;

    // Kiro event names (camelCase)
    expect(hooks.stop).toBeDefined();
    expect(hooks.userPromptSubmit).toBeDefined();
    expect(hooks.agentSpawn).toBeDefined();

    // Should NOT have Claude/Gemini-specific events
    expect(hooks.Stop).toBeUndefined();
    expect(hooks.AfterAgent).toBeUndefined();

    // Verify simpler format: [{ command }] — no matcher, no nested hooks array
    const stopEntries = hooks.stop;
    expect(stopEntries).toHaveLength(1);
    expect(stopEntries[0].command).toContain('.kanban-code/hook.sh');
    expect(stopEntries[0].type).toBeUndefined();
    expect(stopEntries[0].matcher).toBeUndefined();
  });

  it('install for Kiro is idempotent', () => {
    const settingsPath = path.join(tempDir, 'default.json');
    const scriptPath = path.join(tempDir, '.kanban-code', 'hook.sh');
    fs.writeFileSync(settingsPath, '{}');

    HookManager.install({ assistant: 'kiro', settingsPath, hookScriptPath: scriptPath });
    HookManager.install({ assistant: 'kiro', settingsPath, hookScriptPath: scriptPath });

    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(data.hooks.stop).toHaveLength(1);
  });

  it('install for Kiro preserves existing hook entries', () => {
    const settingsPath = path.join(tempDir, 'default.json');
    const scriptPath = path.join(tempDir, '.kanban-code', 'hook.sh');
    const existing = JSON.stringify({
      hooks: {
        stop: [{ command: '/usr/local/bin/other-hook.sh' }],
      },
    });
    fs.writeFileSync(settingsPath, existing);

    HookManager.install({ assistant: 'kiro', settingsPath, hookScriptPath: scriptPath });

    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(data.hooks.stop).toHaveLength(2);
    expect(data.hooks.stop[0].command).toContain('other-hook');
    expect(data.hooks.stop[1].command).toContain('.kanban-code/hook.sh');
  });

  it('isInstalled for Kiro checks Kiro event names with simpler format', () => {
    const settingsPath = path.join(tempDir, 'default.json');
    const scriptPath = path.join(tempDir, '.kanban-code', 'hook.sh');
    fs.writeFileSync(settingsPath, '{}');

    // Install Claude hooks in claude format — Kiro should NOT detect them
    HookManager.install({ assistant: 'claude', settingsPath, hookScriptPath: scriptPath });
    expect(HookManager.isInstalled({ assistant: 'kiro', settingsPath })).toBe(false);
  });

  it('uninstall for Kiro removes only kanban hooks', () => {
    const settingsPath = path.join(tempDir, 'default.json');
    const existing = JSON.stringify({
      hooks: {
        stop: [
          { command: '/usr/local/bin/other-hook.sh' },
          { command: '/home/user/.kanban-code/hook.sh' },
        ],
        userPromptSubmit: [
          { command: '/home/user/.kanban-code/hook.sh' },
        ],
        agentSpawn: [
          { command: '/home/user/.kanban-code/hook.sh' },
        ],
      },
    });
    fs.writeFileSync(settingsPath, existing);

    HookManager.uninstall({ assistant: 'kiro', settingsPath });

    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hooks = data.hooks;

    // stop should still have the other hook
    expect(hooks.stop).toHaveLength(1);
    expect(hooks.stop[0].command).toContain('other-hook');

    // Empty events should be removed entirely
    expect(hooks.userPromptSubmit).toBeUndefined();
    expect(hooks.agentSpawn).toBeUndefined();
  });

  it('uninstall for Kiro is safe on nonexistent file', () => {
    // Should not throw
    HookManager.uninstall({ assistant: 'kiro', settingsPath: '/nonexistent/path' });
  });

  it('uninstall removes empty event groups entirely', () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    const existing = JSON.stringify({
      hooks: {
        Stop: [
          {
            matcher: '',
            hooks: [
              { type: 'command', command: '/home/user/.kanban-code/hook.sh' },
            ],
          },
        ],
        // Other events with only kanban hooks
        Notification: [
          {
            matcher: '',
            hooks: [
              { type: 'command', command: '/home/user/.kanban-code/hook.sh' },
            ],
          },
        ],
      },
    });
    fs.writeFileSync(settingsPath, existing);

    HookManager.uninstall({ assistant: 'claude', settingsPath });

    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hooks = data.hooks;

    // Groups that became empty should be removed entirely
    expect(hooks.Stop).toBeUndefined();
    expect(hooks.Notification).toBeUndefined();
  });
});
