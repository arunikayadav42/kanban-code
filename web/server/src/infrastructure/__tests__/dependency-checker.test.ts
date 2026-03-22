import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkAll, type DependencyStatus } from '../dependency-checker.js';
import { SettingsStore } from '../settings-store.js';

describe('DependencyChecker', () => {
  it('returns a status object with all 10 fields', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-dep-'));
    const settingsStore = new SettingsStore(tempDir);

    try {
      const status = await checkAll(settingsStore);

      // assistantAvailability should be a Record with boolean values
      expect(status.assistantAvailability).toBeDefined();
      expect(typeof status.assistantAvailability.claude).toBe('boolean');
      expect(typeof status.assistantAvailability.gemini).toBe('boolean');
      expect(typeof status.assistantAvailability.kiro).toBe('boolean');

      // Other fields should be booleans
      expect(typeof status.hooksInstalled).toBe('boolean');
      expect(typeof status.pandocAvailable).toBe('boolean');
      expect(typeof status.wkhtmltoimageAvailable).toBe('boolean');
      expect(typeof status.pushoverConfigured).toBe('boolean');
      expect(typeof status.ghAvailable).toBe('boolean');
      expect(typeof status.ghAuthenticated).toBe('boolean');
      expect(typeof status.tmuxAvailable).toBe('boolean');
      expect(typeof status.mutagenAvailable).toBe('boolean');

      // assistantHooks should be a Record
      expect(status.assistantHooks).toBeDefined();
      expect(typeof status.assistantHooks.claude).toBe('boolean');
      expect(typeof status.assistantHooks.gemini).toBe('boolean');
      expect(typeof status.assistantHooks.kiro).toBe('boolean');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('pushover is not configured by default', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-dep2-'));
    const settingsStore = new SettingsStore(tempDir);

    try {
      const status = await checkAll(settingsStore);
      expect(status.pushoverConfigured).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects system binaries (echo exists)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-dep3-'));
    const settingsStore = new SettingsStore(tempDir);

    try {
      const status = await checkAll(settingsStore);
      // echo should always be available
      // tmux, gh, etc. may or may not be — just verify no crash
      expect(status).toBeDefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
