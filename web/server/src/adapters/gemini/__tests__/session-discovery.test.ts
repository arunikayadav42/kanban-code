import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GeminiSessionDiscovery } from '../session-discovery.js';

describe('GeminiSessionDiscovery', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-gemini-discovery-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createSessionFile(
    slug: string,
    sessionId: string,
    content?: string,
  ): string {
    const chatsDir = path.join(tempDir, 'tmp', slug, 'chats');
    fs.mkdirSync(chatsDir, { recursive: true });

    const json =
      content ??
      JSON.stringify({
        sessionId,
        messages: [
          { type: 'user', content: [{ text: `Hello from ${sessionId}` }] },
          { type: 'gemini', content: 'Response' },
        ],
      });

    const filePath = path.join(chatsDir, `session-${sessionId}.json`);
    fs.writeFileSync(filePath, json, 'utf-8');
    return filePath;
  }

  function writeProjectsJson(mapping: Record<string, string>): void {
    const projectsJson = { projects: mapping };
    fs.writeFileSync(
      path.join(tempDir, 'projects.json'),
      JSON.stringify(projectsJson),
      'utf-8',
    );
  }

  // -- Discovery --

  it('discovers sessions from tmp directory', async () => {
    createSessionFile('my-project', 'sess-001');
    createSessionFile('my-project', 'sess-002');

    const discovery = new GeminiSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(2);
    expect(sessions.every(s => s.assistant === 'gemini')).toBe(true);
  });

  it('sessions are sorted by modification time descending', async () => {
    const path1 = createSessionFile('proj', 'old-session');
    createSessionFile('proj', 'new-session');

    // Make first file older
    const oldDate = new Date(Date.now() - 3600_000);
    fs.utimesSync(path1, oldDate, oldDate);

    const discovery = new GeminiSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('new-session');
    expect(sessions[1].id).toBe('old-session');
  });

  it('maps project path from projects.json', async () => {
    writeProjectsJson({
      '/Users/dev/my-project': 'my-project-slug',
    });
    createSessionFile('my-project-slug', 'mapped-sess');

    const discovery = new GeminiSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].projectPath).toBe('/Users/dev/my-project');
  });

  it('returns null projectPath when slug not in projects.json', async () => {
    // No projects.json
    createSessionFile('unknown-slug', 'unmapped');

    const discovery = new GeminiSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].projectPath).toBeNull();
  });

  it('returns empty for non-existent gemini dir', async () => {
    const discovery = new GeminiSessionDiscovery('/nonexistent/gemini/dir');
    const sessions = await discovery.discoverSessions();
    expect(sessions).toHaveLength(0);
  });

  it('ignores non-session files', async () => {
    createSessionFile('proj', 'valid');

    // Create non-session files
    const chatsDir = path.join(tempDir, 'tmp', 'proj', 'chats');
    fs.writeFileSync(path.join(chatsDir, 'notes.txt'), 'not a session', 'utf-8');
    fs.writeFileSync(path.join(chatsDir, 'config.json'), '{}', 'utf-8');

    const discovery = new GeminiSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('valid');
  });

  it('skips unparseable session files', async () => {
    createSessionFile('proj', 'good');

    // Write a bad session file
    const chatsDir = path.join(tempDir, 'tmp', 'proj', 'chats');
    fs.writeFileSync(path.join(chatsDir, 'session-bad.json'), 'invalid json', 'utf-8');

    const discovery = new GeminiSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('good');
  });

  it('discovers sessions from multiple project slugs', async () => {
    createSessionFile('project-a', 'sess-a');
    createSessionFile('project-b', 'sess-b');

    const discovery = new GeminiSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(2);
    const ids = new Set(sessions.map(s => s.id));
    expect(ids.has('sess-a')).toBe(true);
    expect(ids.has('sess-b')).toBe(true);
  });

  it('session stores jsonlPath pointing to the JSON file', async () => {
    const filePath = createSessionFile('proj', 'path-test');

    const discovery = new GeminiSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].jsonlPath).toBe(filePath);
  });

  it('session extracts firstPrompt from content', async () => {
    createSessionFile('proj', 'prompt-test');

    const discovery = new GeminiSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions[0].firstPrompt).toBe('Hello from prompt-test');
  });

  // -- Caching --

  it('uses mtime caching for unchanged directories', async () => {
    createSessionFile('proj', 'cached-sess');

    const discovery = new GeminiSessionDiscovery(tempDir);

    const first = await discovery.discoverSessions();
    expect(first).toHaveLength(1);

    // Second call should use cache (directory mtime unchanged)
    const second = await discovery.discoverSessions();
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe('cached-sess');
  });

  it('detects new sessions when directory changes', async () => {
    createSessionFile('proj', 'sess-1');

    const discovery = new GeminiSessionDiscovery(tempDir);
    const first = await discovery.discoverSessions();
    expect(first).toHaveLength(1);

    // Add a new session (this changes the chats dir mtime)
    createSessionFile('proj', 'sess-2');

    const second = await discovery.discoverSessions();
    expect(second).toHaveLength(2);
  });

  it('evicts removed sessions', async () => {
    const filePath = createSessionFile('proj', 'to-remove');
    createSessionFile('proj', 'to-keep');

    const discovery = new GeminiSessionDiscovery(tempDir);
    const first = await discovery.discoverSessions();
    expect(first).toHaveLength(2);

    // Remove one session file and touch directory
    fs.unlinkSync(filePath);
    // Touch the chats directory to bust the mtime cache
    const chatsDir = path.join(tempDir, 'tmp', 'proj', 'chats');
    const now = new Date();
    fs.utimesSync(chatsDir, now, now);

    const second = await discovery.discoverSessions();
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe('to-keep');
  });

  it('evicts removed slugs', async () => {
    createSessionFile('proj-a', 'sess-a');
    createSessionFile('proj-b', 'sess-b');

    const discovery = new GeminiSessionDiscovery(tempDir);
    const first = await discovery.discoverSessions();
    expect(first).toHaveLength(2);

    // Remove entire slug directory
    fs.rmSync(path.join(tempDir, 'tmp', 'proj-a'), { recursive: true, force: true });

    const second = await discovery.discoverSessions();
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe('sess-b');
  });

  // -- discoverNewOrModified --

  it('discoverNewOrModified delegates to discoverSessions', async () => {
    createSessionFile('proj', 'sess-1');

    const discovery = new GeminiSessionDiscovery(tempDir);
    const sessions = await discovery.discoverNewOrModified(new Date());
    expect(sessions).toHaveLength(1);
  });
});
