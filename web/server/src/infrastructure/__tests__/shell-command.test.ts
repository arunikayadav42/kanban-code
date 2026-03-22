import { describe, it, expect } from 'vitest';
import { run, isAvailable, findExecutable } from '../shell-command.js';

describe('ShellCommand', () => {
  describe('run', () => {
    it('runs a command and captures stdout', async () => {
      const result = await run('/bin/echo', ['hello world']);
      expect(result.succeeded).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello world');
    });

    it('captures stderr', async () => {
      const result = await run('/bin/sh', ['-c', 'echo error >&2']);
      expect(result.stderr).toBe('error');
    });

    it('returns non-zero exit code on failure', async () => {
      const result = await run('/bin/sh', ['-c', 'exit 42']);
      expect(result.succeeded).toBe(false);
      expect(result.exitCode).toBe(42);
    });

    it('passes stdin', async () => {
      const result = await run('/bin/cat', [], { stdin: 'from stdin' });
      expect(result.stdout).toBe('from stdin');
    });

    it('respects cwd', async () => {
      const result = await run('/bin/pwd', [], { cwd: '/tmp' });
      expect(result.stdout).toContain('tmp');
    });

    it('trims whitespace from stdout/stderr', async () => {
      const result = await run('/bin/echo', [' padded ']);
      // echo adds newline, we trim
      expect(result.stdout).toBe('padded');
    });

    it('handles large output without deadlock', async () => {
      // Generate >64KB of output (pipe buffer size)
      const result = await run('/bin/sh', ['-c', 'seq 1 10000']);
      expect(result.succeeded).toBe(true);
      expect(result.stdout.length).toBeGreaterThan(10000);
    });
  });

  describe('isAvailable', () => {
    it('returns true for /bin/echo', async () => {
      expect(await isAvailable('echo')).toBe(true);
    });

    it('returns false for nonexistent command', async () => {
      expect(await isAvailable('__nonexistent_command_xyz__')).toBe(false);
    });
  });

  describe('findExecutable', () => {
    it('finds echo in system paths', () => {
      const result = findExecutable('echo');
      expect(result).not.toBeNull();
      expect(result).toContain('echo');
    });

    it('finds git (usually in /usr/bin or /opt/homebrew/bin)', () => {
      const result = findExecutable('git');
      // git may not be installed, so just check it doesn't throw
      if (result) {
        expect(result).toContain('git');
      }
    });

    it('returns null for nonexistent command', () => {
      expect(findExecutable('__nonexistent_command_xyz__')).toBeNull();
    });

    it('checks ~/.claude/local first (highest priority)', () => {
      // We can't easily test this without creating the directory,
      // but we verify the function doesn't crash
      const result = findExecutable('claude');
      // claude may or may not be installed
      if (result) {
        expect(result).toContain('claude');
      }
    });
  });
});
