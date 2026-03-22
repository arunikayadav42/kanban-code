import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonlParser } from '../jsonl-parser.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-code-jsonl-test-'));
}

function writeJsonl(dir: string, name: string, lines: string[]): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}

describe('JsonlParser', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('extractMetadata', () => {
    it('extracts metadata from a simple session', async () => {
      const filePath = writeJsonl(tempDir, 'abc-123.jsonl', [
        '{"type":"user","sessionId":"abc-123","message":{"content":"Fix the login bug"},"cwd":"/Users/test/project","timestamp":"2026-01-01T00:00:00Z"}',
        '{"type":"assistant","sessionId":"abc-123","message":{"content":[{"type":"text","text":"I\'ll fix that."}]}}',
      ]);

      const metadata = await JsonlParser.extractMetadata(filePath);
      expect(metadata).not.toBeNull();
      expect(metadata!.sessionId).toBe('abc-123');
      expect(metadata!.firstPrompt).toBe('Fix the login bug');
      expect(metadata!.projectPath).toBe('/Users/test/project');
      expect(metadata!.messageCount).toBe(2);
    });

    it('handles content block array format', async () => {
      const filePath = writeJsonl(tempDir, 'block-1.jsonl', [
        '{"type":"user","sessionId":"block-1","message":{"content":[{"type":"text","text":"Hello world"}]},"cwd":"/test"}',
      ]);

      const metadata = await JsonlParser.extractMetadata(filePath);
      expect(metadata!.firstPrompt).toBe('Hello world');
    });

    it('skips file-history-snapshot lines', async () => {
      const filePath = writeJsonl(tempDir, 'skip-1.jsonl', [
        '{"type":"file-history-snapshot","data":"lots of stuff"}',
        '{"type":"user","sessionId":"skip-1","message":{"content":"The real message"},"cwd":"/test"}',
      ]);

      const metadata = await JsonlParser.extractMetadata(filePath);
      expect(metadata).not.toBeNull();
      expect(metadata!.firstPrompt).toBe('The real message');
      expect(metadata!.messageCount).toBe(1);
    });

    it('returns null for empty file', async () => {
      const filePath = writeJsonl(tempDir, 'empty.jsonl', ['']);
      const metadata = await JsonlParser.extractMetadata(filePath);
      expect(metadata).toBeNull();
    });

    it('returns null for file with only system lines', async () => {
      const filePath = writeJsonl(tempDir, 'sys.jsonl', [
        '{"type":"file-history-snapshot","data":"stuff"}',
        '{"type":"progress","data":"loading"}',
      ]);

      const metadata = await JsonlParser.extractMetadata(filePath);
      expect(metadata).toBeNull();
    });

    it('returns null for nonexistent file', async () => {
      const metadata = await JsonlParser.extractMetadata('/nonexistent/path.jsonl');
      expect(metadata).toBeNull();
    });

    it('extracts git branch', async () => {
      const filePath = writeJsonl(tempDir, 'branch.jsonl', [
        '{"type":"user","sessionId":"b1","message":{"content":"Hello"},"cwd":"/test","gitBranch":"feat/login"}',
        '{"type":"assistant","sessionId":"b1","message":{"content":[{"type":"text","text":"Hi"}]}}',
      ]);

      const metadata = await JsonlParser.extractMetadata(filePath);
      expect(metadata!.gitBranch).toBe('feat/login');
    });

    it('stops early after 5 messages when first prompt found', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 10; i++) {
        lines.push(`{"type":"user","sessionId":"s1","message":{"content":"Message ${i}"},"cwd":"/test"}`);
        lines.push(`{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"text","text":"Reply ${i}"}]}}`);
      }
      const filePath = writeJsonl(tempDir, 'many.jsonl', lines);

      const metadata = await JsonlParser.extractMetadata(filePath);
      expect(metadata).not.toBeNull();
      // Should stop at >= 5 messages, not read all 20
      expect(metadata!.messageCount).toBeGreaterThanOrEqual(5);
      expect(metadata!.messageCount).toBeLessThanOrEqual(6);
      expect(metadata!.firstPrompt).toBe('Message 0');
    });
  });

  describe('metadata filtering', () => {
    it('skips isMeta caveat messages for first prompt', async () => {
      const filePath = writeJsonl(tempDir, 'meta-1.jsonl', [
        '{"type":"user","isMeta":true,"sessionId":"m1","message":{"content":"<local-command-caveat>wrapped</local-command-caveat>"},"cwd":"/test"}',
        '{"type":"user","sessionId":"m1","message":{"content":"The real prompt"},"cwd":"/test"}',
        '{"type":"assistant","sessionId":"m1","message":{"content":[{"type":"text","text":"OK"}]}}',
      ]);

      const metadata = await JsonlParser.extractMetadata(filePath);
      expect(metadata!.firstPrompt).toBe('The real prompt');
    });

    it('skips command-name messages for first prompt', async () => {
      const filePath = writeJsonl(tempDir, 'meta-2.jsonl', [
        '{"type":"user","sessionId":"m2","message":{"content":"<command-name>/clear</command-name><command-message></command-message><command-args></command-args>"},"cwd":"/test"}',
        '{"type":"user","sessionId":"m2","message":{"content":"Fix the bug"},"cwd":"/test"}',
        '{"type":"assistant","sessionId":"m2","message":{"content":[{"type":"text","text":"OK"}]}}',
      ]);

      const metadata = await JsonlParser.extractMetadata(filePath);
      expect(metadata!.firstPrompt).toBe('Fix the bug');
    });

    it('skips local-command-stdout messages for first prompt', async () => {
      const filePath = writeJsonl(tempDir, 'meta-3.jsonl', [
        '{"type":"user","sessionId":"m3","message":{"content":"<local-command-stdout>some output</local-command-stdout>"},"cwd":"/test"}',
        '{"type":"user","sessionId":"m3","message":{"content":"Do something"},"cwd":"/test"}',
      ]);

      const metadata = await JsonlParser.extractMetadata(filePath);
      expect(metadata!.firstPrompt).toBe('Do something');
    });
  });

  describe('stripMetadataTags', () => {
    it('removes known tags', () => {
      const text = '<command-name>/clear</command-name><command-message>msg</command-message>real text';
      const stripped = JsonlParser.stripMetadataTags(text);
      expect(stripped).toBe('real text');
    });

    it('removes local-command-caveat', () => {
      expect(JsonlParser.stripMetadataTags('<local-command-caveat>stuff</local-command-caveat>')).toBe('');
    });

    it('removes command-args', () => {
      expect(JsonlParser.stripMetadataTags('<command-args>foo</command-args>remaining')).toBe('remaining');
    });

    it('removes local-command-stdout', () => {
      expect(JsonlParser.stripMetadataTags('<local-command-stdout>output</local-command-stdout>')).toBe('');
    });
  });

  describe('parseLocalCommand', () => {
    it('extracts command name', () => {
      const text = '<command-name>/clear</command-name><command-message></command-message><command-args></command-args>';
      const command = JsonlParser.parseLocalCommand(text);
      expect(command).toBe('/clear');
    });

    it('returns null for no command', () => {
      expect(JsonlParser.parseLocalCommand('no command here')).toBeNull();
    });
  });

  describe('parseLocalCommandStdout', () => {
    it('extracts output', () => {
      const text = '<local-command-stdout>hello world</local-command-stdout>';
      const stdout = JsonlParser.parseLocalCommandStdout(text);
      expect(stdout).toBe('hello world');
    });

    it('returns null for no stdout', () => {
      expect(JsonlParser.parseLocalCommandStdout('no stdout here')).toBeNull();
    });
  });

  describe('isCaveatMessage', () => {
    it('detects isMeta flag', () => {
      expect(JsonlParser.isCaveatMessage({ type: 'user', isMeta: true, message: { content: 'test' } })).toBe(true);
    });

    it('returns false for normal messages', () => {
      expect(JsonlParser.isCaveatMessage({ type: 'user', message: { content: 'test' } })).toBe(false);
    });
  });

  describe('isMetadataMessage', () => {
    it('returns true for isMeta flag', () => {
      expect(JsonlParser.isMetadataMessage({ type: 'user', isMeta: true, message: { content: 'test' } })).toBe(true);
    });

    it('returns true for all-tags content', () => {
      const obj = { type: 'user', message: { content: '<command-name>/clear</command-name><command-message></command-message><command-args></command-args>' } };
      expect(JsonlParser.isMetadataMessage(obj)).toBe(true);
    });

    it('returns false for real user content', () => {
      const obj = { type: 'user', message: { content: 'Fix the bug' } };
      expect(JsonlParser.isMetadataMessage(obj)).toBe(false);
    });
  });

  describe('isLocalCommandStdout', () => {
    it('detects stdout content', () => {
      const obj = { type: 'user', message: { content: '<local-command-stdout>output</local-command-stdout>' } };
      expect(JsonlParser.isLocalCommandStdout(obj)).toBe(true);
    });

    it('returns false for normal content', () => {
      const obj = { type: 'user', message: { content: 'normal text' } };
      expect(JsonlParser.isLocalCommandStdout(obj)).toBe(false);
    });
  });

  describe('decodeDirectoryName', () => {
    it('decodes directory name to path', () => {
      expect(JsonlParser.decodeDirectoryName('-Users-rchaves-Projects-remote-langwatch'))
        .toBe('/Users/rchaves/Projects/remote/langwatch');
    });

    it('preserves root slash', () => {
      expect(JsonlParser.decodeDirectoryName('-home-ubuntu-Projects'))
        .toBe('/home/ubuntu/Projects');
    });
  });

  describe('extractTextContent', () => {
    it('extracts string content', () => {
      const obj = { message: { content: 'Hello world' } };
      expect(JsonlParser.extractTextContent(obj)).toBe('Hello world');
    });

    it('extracts array content blocks', () => {
      const obj = { message: { content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: 'World' }] } };
      expect(JsonlParser.extractTextContent(obj)).toBe('Hello\nWorld');
    });

    it('returns null for no message', () => {
      expect(JsonlParser.extractTextContent({})).toBeNull();
    });

    it('returns null for empty content array', () => {
      const obj = { message: { content: [{ type: 'tool_use', name: 'Bash' }] } };
      expect(JsonlParser.extractTextContent(obj)).toBeNull();
    });
  });

  describe('extractPushedBranches', () => {
    it('finds git push branches', async () => {
      const filePath = writeJsonl(tempDir, 'push.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin feat/login"}}]}}',
      ]);

      const branches = await JsonlParser.extractPushedBranches(filePath);
      expect(branches).toHaveLength(1);
      expect(branches[0].branch).toBe('feat/login');
      expect(branches[0].repoPath).toBeNull();
    });

    it('finds git checkout -b branches', async () => {
      const filePath = writeJsonl(tempDir, 'checkout.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git checkout -b feat/signup"}}]}}',
      ]);

      const branches = await JsonlParser.extractPushedBranches(filePath);
      expect(branches).toHaveLength(1);
      expect(branches[0].branch).toBe('feat/signup');
    });

    it('finds git switch -c branches', async () => {
      const filePath = writeJsonl(tempDir, 'switch.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git switch -c feat/dashboard"}}]}}',
      ]);

      const branches = await JsonlParser.extractPushedBranches(filePath);
      expect(branches).toHaveLength(1);
      expect(branches[0].branch).toBe('feat/dashboard');
    });

    it('finds git switch --create branches', async () => {
      const filePath = writeJsonl(tempDir, 'switch-create.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git switch --create feat/settings"}}]}}',
      ]);

      const branches = await JsonlParser.extractPushedBranches(filePath);
      expect(branches).toHaveLength(1);
      expect(branches[0].branch).toBe('feat/settings');
    });

    it('finds git worktree add -b branches', async () => {
      const filePath = writeJsonl(tempDir, 'worktree.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git worktree add /path/to/wt -b feat/wt-branch"}}]}}',
      ]);

      const branches = await JsonlParser.extractPushedBranches(filePath);
      expect(branches).toHaveLength(1);
      expect(branches[0].branch).toBe('feat/wt-branch');
    });

    it('excludes main and master', async () => {
      const filePath = writeJsonl(tempDir, 'mainmaster.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin main"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin master"}}]}}',
      ]);

      const branches = await JsonlParser.extractPushedBranches(filePath);
      expect(branches).toHaveLength(0);
    });

    it('excludes flag-like branches', async () => {
      const filePath = writeJsonl(tempDir, 'flags.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push --force origin -u"}}]}}',
      ]);

      const branches = await JsonlParser.extractPushedBranches(filePath);
      expect(branches).toHaveLength(0);
    });

    it('deduplicates branches', async () => {
      const filePath = writeJsonl(tempDir, 'dedup.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin feat/dup"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin feat/dup"}}]}}',
      ]);

      const branches = await JsonlParser.extractPushedBranches(filePath);
      expect(branches).toHaveLength(1);
    });

    it('extracts repo path from cd prefix', async () => {
      const filePath = writeJsonl(tempDir, 'cd.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"cd /path/to/repo && git push origin feat/cd-branch"}}]}}',
      ]);

      const branches = await JsonlParser.extractPushedBranches(filePath);
      expect(branches).toHaveLength(1);
      expect(branches[0].branch).toBe('feat/cd-branch');
      expect(branches[0].repoPath).toBe('/path/to/repo');
    });

    it('resolves .claude/worktrees paths to git root', async () => {
      const filePath = writeJsonl(tempDir, 'wt-cd.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"cd /repo/.claude/worktrees/my-wt && git push origin feat/wt"}}]}}',
      ]);

      const branches = await JsonlParser.extractPushedBranches(filePath);
      expect(branches).toHaveLength(1);
      expect(branches[0].repoPath).toBe('/repo');
    });

    it('returns empty for nonexistent file', async () => {
      const branches = await JsonlParser.extractPushedBranches('/nonexistent/path.jsonl');
      expect(branches).toHaveLength(0);
    });

    it('returns sorted results', async () => {
      const filePath = writeJsonl(tempDir, 'sorted.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin zeta-branch"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin alpha-branch"}}]}}',
      ]);

      const branches = await JsonlParser.extractPushedBranches(filePath);
      expect(branches).toHaveLength(2);
      expect(branches[0].branch).toBe('alpha-branch');
      expect(branches[1].branch).toBe('zeta-branch');
    });

    it('supports startOffset for incremental scanning', async () => {
      const line1 = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin first-branch"}}]}}';
      const line2 = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin second-branch"}}]}}';
      const filePath = writeJsonl(tempDir, 'offset.jsonl', [line1, line2]);

      // The offset is past the first line
      const offset = Buffer.byteLength(line1 + '\n', 'utf-8');
      const branches = await JsonlParser.extractPushedBranches(filePath, offset);
      expect(branches).toHaveLength(1);
      expect(branches[0].branch).toBe('second-branch');
    });

    it('handles git push with flags', async () => {
      const filePath = writeJsonl(tempDir, 'pushflags.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push -u origin feat/with-flags"}}]}}',
      ]);

      const branches = await JsonlParser.extractPushedBranches(filePath);
      expect(branches).toHaveLength(1);
      expect(branches[0].branch).toBe('feat/with-flags');
    });

    it('handles git push to upstream', async () => {
      const filePath = writeJsonl(tempDir, 'upstream.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push upstream feat/upstream-branch"}}]}}',
      ]);

      const branches = await JsonlParser.extractPushedBranches(filePath);
      expect(branches).toHaveLength(1);
      expect(branches[0].branch).toBe('feat/upstream-branch');
    });
  });

  describe('extractLatestPushedBranch', () => {
    it('finds the latest pushed branch (last in file)', async () => {
      const filePath = writeJsonl(tempDir, 'latest.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin first-branch"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin second-branch"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin latest-branch"}}]}}',
      ]);

      const branch = await JsonlParser.extractLatestPushedBranch(filePath);
      expect(branch).not.toBeNull();
      expect(branch!.branch).toBe('latest-branch');
    });

    it('returns null for nonexistent file', async () => {
      const result = await JsonlParser.extractLatestPushedBranch('/nonexistent/path.jsonl');
      expect(result).toBeNull();
    });

    it('returns null for file with no pushes', async () => {
      const filePath = writeJsonl(tempDir, 'nopush.jsonl', [
        '{"type":"user","message":{"content":"Hello"}}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}',
      ]);

      const result = await JsonlParser.extractLatestPushedBranch(filePath);
      expect(result).toBeNull();
    });

    it('skips main and master', async () => {
      const filePath = writeJsonl(tempDir, 'skipmain.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin feat/real"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin main"}}]}}',
      ]);

      const branch = await JsonlParser.extractLatestPushedBranch(filePath);
      expect(branch).not.toBeNull();
      expect(branch!.branch).toBe('feat/real');
    });

    it('respects stopAtOffset', async () => {
      const line1 = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin before-offset"}}]}}';
      const line2 = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push origin after-offset"}}]}}';
      const filePath = writeJsonl(tempDir, 'stop.jsonl', [line1, line2]);

      const offset = Buffer.byteLength(line1 + '\n', 'utf-8');
      const branch = await JsonlParser.extractLatestPushedBranch(filePath, offset);
      expect(branch).not.toBeNull();
      expect(branch!.branch).toBe('after-offset');
    });

    it('extracts repo path from cd', async () => {
      const filePath = writeJsonl(tempDir, 'cdlatest.jsonl', [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"cd /my/repo && git push origin latest"}}]}}',
      ]);

      const branch = await JsonlParser.extractLatestPushedBranch(filePath);
      expect(branch!.repoPath).toBe('/my/repo');
    });
  });
});
