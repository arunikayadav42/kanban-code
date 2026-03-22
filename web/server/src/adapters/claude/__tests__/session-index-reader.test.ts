import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SessionIndexReader } from '../session-index-reader.js';

describe('SessionIndexReader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-index-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readIndex', () => {
    it('returns empty array when file does not exist', () => {
      const entries = SessionIndexReader.readIndex('/nonexistent/path.json', 'some-dir');
      expect(entries).toEqual([]);
    });

    it('parses array-based format (sessions array)', () => {
      const indexData = {
        sessions: [
          { sessionId: 'uuid-1', summary: 'Fixed login' },
          { sessionId: 'uuid-2', summary: 'Added tests' },
        ],
      };
      const filePath = path.join(tempDir, 'sessions-index.json');
      fs.writeFileSync(filePath, JSON.stringify(indexData), 'utf-8');

      const entries = SessionIndexReader.readIndex(filePath, '-Users-dev-my-project');

      expect(entries).toHaveLength(2);
      expect(entries[0].sessionId).toBe('uuid-1');
      expect(entries[0].summary).toBe('Fixed login');
      expect(entries[0].projectPath).toBe('/Users/dev/my/project');
      expect(entries[0].directoryName).toBe('-Users-dev-my-project');
      expect(entries[1].sessionId).toBe('uuid-2');
      expect(entries[1].summary).toBe('Added tests');
    });

    it('parses object-based format (UUID keys)', () => {
      const indexData: Record<string, unknown> = {
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890': { summary: 'First session' },
        'b2c3d4e5-f6a7-8901-bcde-f12345678901': { summary: 'Second session' },
      };
      const filePath = path.join(tempDir, 'sessions-index.json');
      fs.writeFileSync(filePath, JSON.stringify(indexData), 'utf-8');

      const entries = SessionIndexReader.readIndex(filePath, '-Users-dev-project');

      expect(entries).toHaveLength(2);
      const ids = entries.map(e => e.sessionId).sort();
      expect(ids).toContain('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(ids).toContain('b2c3d4e5-f6a7-8901-bcde-f12345678901');
    });

    it('skips sessions without sessionId in array format', () => {
      const indexData = {
        sessions: [
          { summary: 'No ID' }, // missing sessionId
          { sessionId: 'uuid-1', summary: 'Has ID' },
        ],
      };
      const filePath = path.join(tempDir, 'sessions-index.json');
      fs.writeFileSync(filePath, JSON.stringify(indexData), 'utf-8');

      const entries = SessionIndexReader.readIndex(filePath, 'dir');
      expect(entries).toHaveLength(1);
      expect(entries[0].sessionId).toBe('uuid-1');
    });

    it('skips short keys in object format', () => {
      const indexData: Record<string, unknown> = {
        version: 1, // short key, not a UUID
        entries: [], // short key, not a UUID
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890': { summary: 'Valid' },
      };
      const filePath = path.join(tempDir, 'sessions-index.json');
      fs.writeFileSync(filePath, JSON.stringify(indexData), 'utf-8');

      const entries = SessionIndexReader.readIndex(filePath, 'dir');
      expect(entries).toHaveLength(1);
      expect(entries[0].sessionId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    it('handles sessions with null summary', () => {
      const indexData = {
        sessions: [{ sessionId: 'uuid-1' }],
      };
      const filePath = path.join(tempDir, 'sessions-index.json');
      fs.writeFileSync(filePath, JSON.stringify(indexData), 'utf-8');

      const entries = SessionIndexReader.readIndex(filePath, 'dir');
      expect(entries).toHaveLength(1);
      expect(entries[0].summary).toBeNull();
    });

    it('returns empty for non-object JSON', () => {
      const filePath = path.join(tempDir, 'sessions-index.json');
      fs.writeFileSync(filePath, '"just a string"', 'utf-8');

      const entries = SessionIndexReader.readIndex(filePath, 'dir');
      expect(entries).toEqual([]);
    });

    it('prefers array format when both "sessions" and UUID keys exist', () => {
      const indexData = {
        sessions: [{ sessionId: 'from-array', summary: 'Array' }],
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890': { summary: 'UUID key' },
      };
      const filePath = path.join(tempDir, 'sessions-index.json');
      fs.writeFileSync(filePath, JSON.stringify(indexData), 'utf-8');

      const entries = SessionIndexReader.readIndex(filePath, 'dir');
      // Array format is preferred; UUID keys only used as fallback when entries is empty
      expect(entries).toHaveLength(1);
      expect(entries[0].sessionId).toBe('from-array');
    });

    it('decodes directory name to project path', () => {
      const indexData = {
        sessions: [{ sessionId: 'uuid-1', summary: 'Test' }],
      };
      const filePath = path.join(tempDir, 'sessions-index.json');
      fs.writeFileSync(filePath, JSON.stringify(indexData), 'utf-8');

      const entries = SessionIndexReader.readIndex(filePath, '-Users-mayankw-Documents-Projects');
      expect(entries[0].projectPath).toBe('/Users/mayankw/Documents/Projects');
    });
  });

  describe('updateSummary', () => {
    it('updates summary for a matching session', () => {
      // Create a project dir with sessions-index.json
      const projectDir = path.join(tempDir, 'my-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const indexData = {
        version: 1,
        entries: [
          { sessionId: 'uuid-1', summary: 'Old summary' },
          { sessionId: 'uuid-2', summary: 'Other session' },
        ],
      };
      const indexPath = path.join(projectDir, 'sessions-index.json');
      fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8');

      SessionIndexReader.updateSummary('uuid-1', 'New summary', tempDir);

      const updated = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      expect(updated.entries[0].summary).toBe('New summary');
      expect(updated.entries[1].summary).toBe('Other session');
    });

    it('does nothing when session is not found', () => {
      const projectDir = path.join(tempDir, 'my-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const indexData = {
        version: 1,
        entries: [{ sessionId: 'uuid-1', summary: 'Original' }],
      };
      const indexPath = path.join(projectDir, 'sessions-index.json');
      fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8');

      SessionIndexReader.updateSummary('nonexistent', 'New summary', tempDir);

      const unchanged = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      expect(unchanged.entries[0].summary).toBe('Original');
    });

    it('does nothing when base dir does not exist', () => {
      // Should not throw
      SessionIndexReader.updateSummary('uuid-1', 'New', '/nonexistent/path');
    });

    it('searches across multiple project directories', () => {
      // Create two project dirs
      const projA = path.join(tempDir, 'project-a');
      const projB = path.join(tempDir, 'project-b');
      fs.mkdirSync(projA, { recursive: true });
      fs.mkdirSync(projB, { recursive: true });

      const indexA = {
        version: 1,
        entries: [{ sessionId: 'uuid-a', summary: 'A' }],
      };
      const indexB = {
        version: 1,
        entries: [{ sessionId: 'uuid-b', summary: 'B' }],
      };
      fs.writeFileSync(path.join(projA, 'sessions-index.json'), JSON.stringify(indexA), 'utf-8');
      fs.writeFileSync(path.join(projB, 'sessions-index.json'), JSON.stringify(indexB), 'utf-8');

      SessionIndexReader.updateSummary('uuid-b', 'Updated B', tempDir);

      const updatedB = JSON.parse(fs.readFileSync(path.join(projB, 'sessions-index.json'), 'utf-8'));
      expect(updatedB.entries[0].summary).toBe('Updated B');

      // A should be unchanged
      const unchangedA = JSON.parse(fs.readFileSync(path.join(projA, 'sessions-index.json'), 'utf-8'));
      expect(unchangedA.entries[0].summary).toBe('A');
    });
  });
});
