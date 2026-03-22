import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SettingsStore, SettingsError, createDefaultSettings, parseSettings } from '../settings-store.js';
import { createProject } from '@kanban-code/shared';

describe('SettingsStore', () => {
  let tempDir: string;
  let store: SettingsStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-settings-'));
    store = new SettingsStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('read', () => {
    it('creates default settings when file does not exist', () => {
      const settings = store.read();
      expect(settings.projects).toEqual([]);
      expect(settings.github.defaultFilter).toBe('assignee:@me is:open');
      expect(settings.github.pollIntervalSeconds).toBe(60);
      expect(settings.sessionTimeout.activeThresholdMinutes).toBe(1440);
      expect(settings.hasCompletedOnboarding).toBe(false);
      expect(settings.enabledAssistants).toEqual(['claude', 'gemini', 'kiro']);
      // File should be created
      expect(fs.existsSync(store.path)).toBe(true);
    });

    it('reads settings from file', () => {
      const custom = createDefaultSettings();
      custom.hasCompletedOnboarding = true;
      custom.promptTemplate = '/orchestrate ${prompt}';
      store.write(custom);

      const read = store.read();
      expect(read.hasCompletedOnboarding).toBe(true);
      expect(read.promptTemplate).toBe('/orchestrate ${prompt}');
    });

    it('returns cached settings when mtime unchanged', () => {
      store.read(); // first read creates file
      const s1 = store.read();
      const s2 = store.read();
      // Same reference if cached
      expect(s1).toBe(s2);
    });

    it('re-reads from disk when mtime changes', () => {
      store.read(); // create file
      // Modify file externally
      const settings = createDefaultSettings();
      settings.hasCompletedOnboarding = true;
      fs.writeFileSync(store.path, JSON.stringify(settings, null, 2));
      store.invalidateCache();
      const read = store.read();
      expect(read.hasCompletedOnboarding).toBe(true);
    });
  });

  describe('write', () => {
    it('writes valid JSON', () => {
      const settings = createDefaultSettings();
      settings.promptTemplate = 'test template';
      store.write(settings);
      const raw = JSON.parse(fs.readFileSync(store.path, 'utf-8'));
      expect(raw.promptTemplate).toBe('test template');
    });

    it('atomic write leaves no .tmp file', () => {
      store.write(createDefaultSettings());
      expect(fs.existsSync(store.path + '.tmp')).toBe(false);
    });
  });

  describe('parseSettings — backward compat', () => {
    it('reads "skill" as promptTemplate fallback', () => {
      const json = { skill: '/orchestrate ${prompt}' };
      const settings = parseSettings(json);
      expect(settings.promptTemplate).toBe('/orchestrate ${prompt}');
    });

    it('promptTemplate takes precedence over skill', () => {
      const json = { promptTemplate: 'new', skill: 'old' };
      const settings = parseSettings(json);
      expect(settings.promptTemplate).toBe('new');
    });

    it('defaults all fields gracefully', () => {
      const settings = parseSettings({});
      expect(settings.projects).toEqual([]);
      expect(settings.github.defaultFilter).toBe('assignee:@me is:open');
      expect(settings.github.pollIntervalSeconds).toBe(60);
      expect(settings.github.mergeCommand).toContain('gh pr merge');
      expect(settings.sessionTimeout.activeThresholdMinutes).toBe(1440);
      expect(settings.githubIssuePromptTemplate).toBe('#${number}: ${title}\n\n${body}');
      expect(settings.columnOrder).toHaveLength(6);
      expect(settings.defaultAssistant).toBeNull();
    });
  });

  describe('project convenience methods', () => {
    it('addProject adds and persists', () => {
      const project = createProject('/Users/me/repo');
      store.read(); // init file
      store.addProject(project);
      expect(store.read().projects).toHaveLength(1);
      expect(store.read().projects[0].path).toBe('/Users/me/repo');
    });

    it('addProject throws on duplicate', () => {
      store.read();
      store.addProject(createProject('/Users/me/repo'));
      expect(() => store.addProject(createProject('/Users/me/repo'))).toThrow(SettingsError);
    });

    it('updateProject updates existing', () => {
      store.read();
      store.addProject(createProject('/Users/me/repo', { name: 'Old' }));
      store.updateProject(createProject('/Users/me/repo', { name: 'New' }));
      expect(store.read().projects[0].name).toBe('New');
    });

    it('updateProject throws if not found', () => {
      store.read();
      expect(() => store.updateProject(createProject('/nonexistent'))).toThrow(SettingsError);
    });

    it('removeProject removes', () => {
      store.read();
      store.addProject(createProject('/Users/me/a'));
      store.addProject(createProject('/Users/me/b'));
      store.removeProject('/Users/me/a');
      expect(store.read().projects).toHaveLength(1);
      expect(store.read().projects[0].path).toBe('/Users/me/b');
    });

    it('removeProject throws if not found', () => {
      store.read();
      expect(() => store.removeProject('/nonexistent')).toThrow(SettingsError);
    });

    it('reorderProjects replaces project list', () => {
      store.read();
      store.addProject(createProject('/a'));
      store.addProject(createProject('/b'));
      const reversed = [...store.read().projects].reverse();
      store.reorderProjects(reversed);
      expect(store.read().projects[0].path).toBe('/b');
    });
  });
});
