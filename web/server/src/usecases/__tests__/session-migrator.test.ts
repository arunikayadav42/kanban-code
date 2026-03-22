import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { migrate, MigrationError } from '../session-migrator.js';
import type { SessionStore } from '../../domain/ports/session-store.js';
import type { ConversationTurn } from '@kanban-code/shared';

/** Creates a mock SessionStore. */
function mockStore(options?: {
  turns?: ConversationTurn[];
  writtenPath?: string;
}): SessionStore & { written: { turns: ConversationTurn[]; sessionId: string; projectPath: string | null }[] } {
  const written: { turns: ConversationTurn[]; sessionId: string; projectPath: string | null }[] = [];
  return {
    written,
    readTranscript: async () => options?.turns ?? [],
    forkSession: async () => '',
    truncateSession: async () => {},
    searchSessions: async () => [],
    searchSessionsStreaming: async () => {},
    writeSession: async (turns, sessionId, projectPath) => {
      written.push({ turns, sessionId, projectPath: projectPath ?? null });
      return options?.writtenPath ?? `/tmp/sessions/${sessionId}.jsonl`;
    },
    resolveSessionPath(_sessionId: string, originalPath: string): string {
      return originalPath;
    },
  };
}

describe('SessionMigrator', () => {
  const tmpDir = path.join(os.tmpdir(), `kanban-migrator-test-${process.pid}`);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleTurns: ConversationTurn[] = [
    { index: 0, lineNumber: 1, role: 'user', textPreview: 'Hello', contentBlocks: [] },
    { index: 1, lineNumber: 2, role: 'assistant', textPreview: 'Hi there!', contentBlocks: [] },
  ];

  it('reads transcript from source, writes to target, and returns result', async () => {
    const sourcePath = path.join(tmpDir, 'source-session.jsonl');
    fs.writeFileSync(sourcePath, 'source data', 'utf-8');

    const targetPath = '/tmp/sessions/new-session.jsonl';
    const sourceStore = mockStore({ turns: sampleTurns });
    const targetStore = mockStore({ writtenPath: targetPath });

    const result = await migrate(sourcePath, sourceStore, targetStore, '/Users/me/project');

    // Verify result structure
    expect(result.newSessionId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    expect(result.newSessionPath).toBe(targetPath);
    expect(result.backupPath).toBe(sourcePath + '.bak');

    // Verify target store received the turns
    expect(targetStore.written).toHaveLength(1);
    expect(targetStore.written[0]!.turns).toEqual(sampleTurns);
    expect(targetStore.written[0]!.sessionId).toBe(result.newSessionId);
    expect(targetStore.written[0]!.projectPath).toBe('/Users/me/project');
  });

  it('creates a backup of the source file', async () => {
    const sourcePath = path.join(tmpDir, 'source.jsonl');
    fs.writeFileSync(sourcePath, 'original content', 'utf-8');

    const sourceStore = mockStore({ turns: sampleTurns });
    const targetStore = mockStore();

    await migrate(sourcePath, sourceStore, targetStore, null);

    // Backup should exist with original content
    expect(fs.existsSync(sourcePath + '.bak')).toBe(true);
    expect(fs.readFileSync(sourcePath + '.bak', 'utf-8')).toBe('original content');
  });

  it('removes the source file after backup', async () => {
    const sourcePath = path.join(tmpDir, 'source.jsonl');
    fs.writeFileSync(sourcePath, 'original content', 'utf-8');

    const sourceStore = mockStore({ turns: sampleTurns });
    const targetStore = mockStore();

    await migrate(sourcePath, sourceStore, targetStore, null);

    // Source should be gone
    expect(fs.existsSync(sourcePath)).toBe(false);
  });

  it('removes existing .bak file before creating new backup', async () => {
    const sourcePath = path.join(tmpDir, 'source.jsonl');
    fs.writeFileSync(sourcePath, 'new content', 'utf-8');
    fs.writeFileSync(sourcePath + '.bak', 'old backup', 'utf-8');

    const sourceStore = mockStore({ turns: sampleTurns });
    const targetStore = mockStore();

    await migrate(sourcePath, sourceStore, targetStore, null);

    // Backup should contain new content
    expect(fs.readFileSync(sourcePath + '.bak', 'utf-8')).toBe('new content');
  });

  it('throws MigrationError for empty session', async () => {
    const sourcePath = path.join(tmpDir, 'empty.jsonl');
    fs.writeFileSync(sourcePath, '', 'utf-8');

    const sourceStore = mockStore({ turns: [] });
    const targetStore = mockStore();

    await expect(migrate(sourcePath, sourceStore, targetStore, null))
      .rejects.toThrow(MigrationError);
  });

  it('MigrationError has descriptive message', () => {
    const error = new MigrationError('emptySession');
    expect(error.message).toBe('Session has no conversation turns to migrate');
    expect(error.code).toBe('emptySession');
    expect(error.name).toBe('MigrationError');
  });

  it('generates a unique session ID for each migration', async () => {
    const sourcePath1 = path.join(tmpDir, 'source1.jsonl');
    const sourcePath2 = path.join(tmpDir, 'source2.jsonl');
    fs.writeFileSync(sourcePath1, 'data', 'utf-8');
    fs.writeFileSync(sourcePath2, 'data', 'utf-8');

    const sourceStore = mockStore({ turns: sampleTurns });
    const targetStore = mockStore();

    const result1 = await migrate(sourcePath1, sourceStore, targetStore, null);
    const result2 = await migrate(sourcePath2, sourceStore, targetStore, null);

    expect(result1.newSessionId).not.toBe(result2.newSessionId);
  });

  it('passes null projectPath through to target store', async () => {
    const sourcePath = path.join(tmpDir, 'source.jsonl');
    fs.writeFileSync(sourcePath, 'data', 'utf-8');

    const sourceStore = mockStore({ turns: sampleTurns });
    const targetStore = mockStore();

    await migrate(sourcePath, sourceStore, targetStore, null);

    expect(targetStore.written[0]!.projectPath).toBeNull();
  });
});
