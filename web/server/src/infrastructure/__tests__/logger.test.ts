import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { info, warn, error, getLogPath, _setLogPath } from '../logger.js';

describe('Logger', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-log-'));
  const testLogPath = path.join(tempDir, 'test.log');

  beforeEach(() => {
    _setLogPath(testLogPath);
    try { fs.unlinkSync(testLogPath); } catch { /* ignore */ }
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes info log in correct format', async () => {
    info('test-subsystem', 'Hello world');
    await new Promise(r => setTimeout(r, 100));
    const content = fs.readFileSync(testLogPath, 'utf-8');
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(content).toContain('[INFO]');
    expect(content).toContain('[test-subsystem]');
    expect(content).toContain('Hello world');
  });

  it('writes warn log', async () => {
    warn('reconciler', 'Something suspicious');
    await new Promise(r => setTimeout(r, 100));
    const content = fs.readFileSync(testLogPath, 'utf-8');
    expect(content).toContain('[WARN]');
    expect(content).toContain('[reconciler]');
  });

  it('writes error log', async () => {
    error('tmux', 'Session creation failed');
    await new Promise(r => setTimeout(r, 100));
    const content = fs.readFileSync(testLogPath, 'utf-8');
    expect(content).toContain('[ERROR]');
    expect(content).toContain('[tmux]');
  });

  it('appends multiple log lines', async () => {
    info('a', 'line 1');
    info('b', 'line 2');
    info('c', 'line 3');
    await new Promise(r => setTimeout(r, 200));
    const content = fs.readFileSync(testLogPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(3);
  });
});
