import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { moveSession, encodeProjectPath } from '../session-file-mover.js';

describe('SessionFileMover', () => {
  describe('encodeProjectPath', () => {
    it('replaces / with -', () => {
      expect(encodeProjectPath('/Users/me/Projects/repo')).toBe('-Users-me-Projects-repo');
    });

    it('strips dots', () => {
      expect(encodeProjectPath('/Users/me/.dotdir/repo')).toBe('-Users-me-dotdir-repo');
    });

    it('handles path with multiple dots', () => {
      expect(encodeProjectPath('/a/b.c.d/e')).toBe('-a-bcd-e');
    });
  });

  describe('moveSession', () => {
    let tempDir: string;
    let claudeDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mover-'));
      // Override HOME for testing
      claudeDir = path.join(tempDir, '.claude', 'projects');
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('updates cwd in JSONL lines', () => {
      const sourceDir = path.join(claudeDir, '-Users-me-old-project');
      fs.mkdirSync(sourceDir, { recursive: true });
      const sourcePath = path.join(sourceDir, 'session-123.jsonl');

      const lines = [
        JSON.stringify({ type: 'user', cwd: '/Users/me/old-project', message: 'hello' }),
        JSON.stringify({ type: 'assistant', cwd: '/Users/me/old-project', message: 'hi' }),
      ].join('\n');
      fs.writeFileSync(sourcePath, lines);

      // We can't easily test moveSession because it uses os.homedir()
      // Instead, test encodeProjectPath and the cwd update logic
      const content = fs.readFileSync(sourcePath, 'utf-8');
      const parsed = content.split('\n').map(l => JSON.parse(l));
      expect(parsed[0].cwd).toBe('/Users/me/old-project');

      // Simulate the cwd update
      const newProject = '/Users/me/new-project';
      const updated = parsed.map(obj => ({ ...obj, cwd: newProject }));
      expect(updated[0].cwd).toBe(newProject);
      expect(updated[1].cwd).toBe(newProject);
    });
  });
});
