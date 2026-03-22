import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ClaudeCodeSessionDiscovery } from '../session-discovery.js';

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `kanban-code-discovery-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('ClaudeCodeSessionDiscovery', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it('discovers sessions from .jsonl files', async () => {
    const projectDir = path.join(tempDir, '-Users-test-project');
    fs.mkdirSync(projectDir, { recursive: true });

    const jsonlPath = path.join(projectDir, 'session-1.jsonl');
    fs.writeFileSync(jsonlPath, [
      '{"type":"user","sessionId":"session-1","message":{"content":"Hello"},"cwd":"/Users/test/project"}',
      '{"type":"assistant","sessionId":"session-1","message":{"content":[{"type":"text","text":"Hi there"}]}}',
    ].join('\n'));

    const discovery = new ClaudeCodeSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('session-1');
    expect(sessions[0].firstPrompt).toBe('Hello');
    expect(sessions[0].messageCount).toBeGreaterThanOrEqual(2);
  });

  it('merges index metadata with .jsonl scan', async () => {
    const projectDir = path.join(tempDir, '-Users-test-myproject');
    fs.mkdirSync(projectDir, { recursive: true });

    const indexPath = path.join(projectDir, 'sessions-index.json');
    fs.writeFileSync(indexPath, '{"sessions":[{"sessionId":"sess-2","summary":"Fix login flow"}]}');

    const jsonlPath = path.join(projectDir, 'sess-2.jsonl');
    fs.writeFileSync(jsonlPath, '{"type":"user","sessionId":"sess-2","message":{"content":"Fix the login"},"cwd":"/test"}');

    const discovery = new ClaudeCodeSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('sess-2');
    expect(sessions[0].name).toBe('Fix login flow');
    expect(sessions[0].firstPrompt).toBe('Fix the login');
  });

  it('filters out zero-message sessions', async () => {
    const projectDir = path.join(tempDir, '-Users-test-empty');
    fs.mkdirSync(projectDir, { recursive: true });

    const jsonlPath = path.join(projectDir, 'empty-sess.jsonl');
    fs.writeFileSync(jsonlPath, '{"type":"file-history-snapshot","data":"stuff"}');

    const discovery = new ClaudeCodeSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(0);
  });

  it('returns empty for empty directory', async () => {
    const discovery = new ClaudeCodeSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(0);
  });

  it('returns empty for nonexistent directory', async () => {
    const discovery = new ClaudeCodeSessionDiscovery('/nonexistent/path');
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(0);
  });

  it('sorts sessions by modification time (newest first)', async () => {
    const projectDir = path.join(tempDir, '-Users-test-sorted');
    fs.mkdirSync(projectDir, { recursive: true });

    const path1 = path.join(projectDir, 'old-sess.jsonl');
    fs.writeFileSync(path1, '{"type":"user","sessionId":"old-sess","message":{"content":"Old"},"cwd":"/test"}');

    // Set old mtime
    const oldTime = new Date(Date.now() - 10000);
    fs.utimesSync(path1, oldTime, oldTime);

    const path2 = path.join(projectDir, 'new-sess.jsonl');
    fs.writeFileSync(path2, '{"type":"user","sessionId":"new-sess","message":{"content":"New"},"cwd":"/test"}');

    const discovery = new ClaudeCodeSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions.length).toBe(2);
    expect(sessions[0].id).toBe('new-sess');
    expect(sessions[1].id).toBe('old-sess');
  });

  it('uses mtime cache to skip unchanged directories', async () => {
    const projectDir = path.join(tempDir, '-Users-test-cache');
    fs.mkdirSync(projectDir, { recursive: true });

    const jsonlPath = path.join(projectDir, 'sess-a.jsonl');
    fs.writeFileSync(jsonlPath, '{"type":"user","sessionId":"sess-a","message":{"content":"Hello"},"cwd":"/test"}');

    const discovery = new ClaudeCodeSessionDiscovery(tempDir);

    // First scan
    const sessions1 = await discovery.discoverSessions();
    expect(sessions1.length).toBe(1);

    // Second scan without changes should use cache
    const sessions2 = await discovery.discoverSessions();
    expect(sessions2.length).toBe(1);
    expect(sessions2[0].id).toBe('sess-a');
  });

  it('evicts sessions from removed directories', async () => {
    const projectDir = path.join(tempDir, '-Users-test-evict');
    fs.mkdirSync(projectDir, { recursive: true });

    const jsonlPath = path.join(projectDir, 'sess-evict.jsonl');
    fs.writeFileSync(jsonlPath, '{"type":"user","sessionId":"sess-evict","message":{"content":"Hi"},"cwd":"/test"}');

    const discovery = new ClaudeCodeSessionDiscovery(tempDir);

    const sessions1 = await discovery.discoverSessions();
    expect(sessions1.length).toBe(1);

    // Remove the directory
    fs.rmSync(projectDir, { recursive: true, force: true });

    const sessions2 = await discovery.discoverSessions();
    expect(sessions2.length).toBe(0);
  });

  it('evicts sessions removed from a directory', async () => {
    const projectDir = path.join(tempDir, '-Users-test-evict-file');
    fs.mkdirSync(projectDir, { recursive: true });

    const jsonlPath1 = path.join(projectDir, 'sess-keep.jsonl');
    fs.writeFileSync(jsonlPath1, '{"type":"user","sessionId":"sess-keep","message":{"content":"Keep"},"cwd":"/test"}');

    const jsonlPath2 = path.join(projectDir, 'sess-remove.jsonl');
    fs.writeFileSync(jsonlPath2, '{"type":"user","sessionId":"sess-remove","message":{"content":"Remove"},"cwd":"/test"}');

    const discovery = new ClaudeCodeSessionDiscovery(tempDir);

    const sessions1 = await discovery.discoverSessions();
    expect(sessions1.length).toBe(2);

    // Remove one file
    fs.unlinkSync(jsonlPath2);

    const sessions2 = await discovery.discoverSessions();
    expect(sessions2.length).toBe(1);
    expect(sessions2[0].id).toBe('sess-keep');
  });

  it('decodes directory name to project path', async () => {
    const projectDir = path.join(tempDir, '-Users-rchaves-Projects-remote-langwatch');
    fs.mkdirSync(projectDir, { recursive: true });

    const jsonlPath = path.join(projectDir, 'sess-decode.jsonl');
    // No cwd in the jsonl — should fall back to decoding dir name
    fs.writeFileSync(jsonlPath, '{"type":"user","sessionId":"sess-decode","message":{"content":"Hello"}}');

    const discovery = new ClaudeCodeSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions.length).toBe(1);
    expect(sessions[0].projectPath).toBe('/Users/rchaves/Projects/remote/langwatch');
  });

  it('discoverNewOrModified delegates to discoverSessions', async () => {
    const projectDir = path.join(tempDir, '-Users-test-newmod');
    fs.mkdirSync(projectDir, { recursive: true });

    const jsonlPath = path.join(projectDir, 'sess-nm.jsonl');
    fs.writeFileSync(jsonlPath, '{"type":"user","sessionId":"sess-nm","message":{"content":"Hi"},"cwd":"/test"}');

    const discovery = new ClaudeCodeSessionDiscovery(tempDir);
    const sessions = await discovery.discoverNewOrModified(new Date(0));

    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('sess-nm');
  });

  it('skips non-directory entries in claudeDir', async () => {
    // Write a file directly in the claudeDir (not a directory)
    fs.writeFileSync(path.join(tempDir, 'some-file.txt'), 'not a directory');

    const discovery = new ClaudeCodeSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(0);
  });

  it('extracts git branch from jsonl metadata', async () => {
    const projectDir = path.join(tempDir, '-Users-test-branch');
    fs.mkdirSync(projectDir, { recursive: true });

    const jsonlPath = path.join(projectDir, 'sess-branch.jsonl');
    fs.writeFileSync(jsonlPath, [
      '{"type":"user","sessionId":"sess-branch","message":{"content":"Hello"},"cwd":"/test","gitBranch":"feat/login"}',
    ].join('\n'));

    const discovery = new ClaudeCodeSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions.length).toBe(1);
    expect(sessions[0].gitBranch).toBe('feat/login');
  });

  it('handles sessions-index.json with UUID-key format', async () => {
    const projectDir = path.join(tempDir, '-Users-test-uuidformat');
    fs.mkdirSync(projectDir, { recursive: true });

    // UUID-key format index
    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const indexPath = path.join(projectDir, 'sessions-index.json');
    fs.writeFileSync(indexPath, JSON.stringify({
      [sessionId]: { summary: 'UUID format summary' },
    }));

    const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);
    fs.writeFileSync(jsonlPath, `{"type":"user","sessionId":"${sessionId}","message":{"content":"UUID test"},"cwd":"/test"}`);

    const discovery = new ClaudeCodeSessionDiscovery(tempDir);
    const sessions = await discovery.discoverSessions();

    expect(sessions.length).toBe(1);
    expect(sessions[0].name).toBe('UUID format summary');
  });
});
