import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MutagenAdapter, MutagenError, DEFAULT_IGNORES } from '../mutagen-adapter.js';

/**
 * MutagenAdapter tests.
 * All CLI calls are mocked -- tests verify argument construction,
 * output parsing, and error handling.
 */

vi.mock('../../../infrastructure/shell-command.js', () => ({
  run: vi.fn(),
  findExecutable: vi.fn().mockReturnValue('/usr/local/bin/mutagen'),
}));

import { run, findExecutable } from '../../../infrastructure/shell-command.js';

const mockRun = vi.mocked(run);
const mockFindExecutable = vi.mocked(findExecutable);

describe('MutagenAdapter', () => {
  let adapter: MutagenAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindExecutable.mockReturnValue('/usr/local/bin/mutagen');
    adapter = new MutagenAdapter('kanban');
  });

  describe('startSync', () => {
    it('creates sync session with correct arguments', async () => {
      // List check: no existing session
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: '', stderr: '', succeeded: true,
      });
      // Create call
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: '', stderr: '', succeeded: true,
      });

      await adapter.startSync('/local', 'user@host:/remote', 'test-sync', ['node_modules']);

      expect(mockRun).toHaveBeenCalledTimes(2);
      const createCall = mockRun.mock.calls[1];
      expect(createCall[1]).toContain('sync');
      expect(createCall[1]).toContain('create');
      expect(createCall[1]).toContain('/local');
      expect(createCall[1]).toContain('user@host:/remote');
      expect(createCall[1]).toContain('--name');
      expect(createCall[1]).toContain('test-sync');
      expect(createCall[1]).toContain('--label');
      expect(createCall[1]).toContain('kanban=true');
      expect(createCall[1]).toContain('--ignore');
      expect(createCall[1]).toContain('node_modules');
    });

    it('flushes and returns if session already exists', async () => {
      // List: session exists
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: 'Name: test-sync\nStatus: Watching', stderr: '', succeeded: true,
      });
      // Flush call
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: '', stderr: '', succeeded: true,
      });

      await adapter.startSync('/local', 'user@host:/remote', 'test-sync');

      // Should only list + flush, not create
      expect(mockRun).toHaveBeenCalledTimes(2);
      const flushCall = mockRun.mock.calls[1];
      expect(flushCall[1]).toContain('flush');
    });

    it('throws MutagenError on create failure', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: '', stderr: '', succeeded: true,
      });
      mockRun.mockResolvedValueOnce({
        exitCode: 1, stdout: '', stderr: 'permission denied', succeeded: false,
      });

      await expect(adapter.startSync('/local', 'host:/remote', 'fail-sync'))
        .rejects.toThrow(MutagenError);
    });

    it('uses default ignores when none provided', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: '', stderr: '', succeeded: true,
      });
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: '', stderr: '', succeeded: true,
      });

      await adapter.startSync('/local', 'host:/remote', 'sync');

      const createCall = mockRun.mock.calls[1];
      const args = createCall[1] as string[];
      // Count --ignore flags: should match DEFAULT_IGNORES length
      const ignoreCount = args.filter(a => a === '--ignore').length;
      expect(ignoreCount).toBe(DEFAULT_IGNORES.length);
    });
  });

  describe('stopSync', () => {
    it('terminates with label selector', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: '', stderr: '', succeeded: true,
      });

      await adapter.stopSync('test-sync');

      expect(mockRun).toHaveBeenCalledTimes(1);
      const call = mockRun.mock.calls[0];
      expect(call[1]).toContain('terminate');
      expect(call[1]).toContain('--label-selector');
      expect(call[1]).toContain('kanban=true');
    });

    it('throws MutagenError on terminate failure', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 1, stdout: '', stderr: 'no sessions', succeeded: false,
      });

      await expect(adapter.stopSync('test-sync')).rejects.toThrow(MutagenError);
    });
  });

  describe('flushSync', () => {
    it('flushes with label selector', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: '', stderr: '', succeeded: true,
      });

      await adapter.flushSync();

      const call = mockRun.mock.calls[0];
      expect(call[1]).toContain('flush');
      expect(call[1]).toContain('kanban=true');
    });

    it('throws MutagenError on flush failure', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 1, stdout: '', stderr: 'timeout', succeeded: false,
      });

      await expect(adapter.flushSync()).rejects.toThrow(MutagenError);
    });
  });

  describe('resetSync', () => {
    it('pauses then resumes', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: '', stderr: '', succeeded: true,
      });
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: '', stderr: '', succeeded: true,
      });

      await adapter.resetSync('test-sync');

      expect(mockRun).toHaveBeenCalledTimes(2);
      expect(mockRun.mock.calls[0][1]).toContain('pause');
      expect(mockRun.mock.calls[1][1]).toContain('resume');
    });

    it('throws MutagenError on resume failure', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: '', stderr: '', succeeded: true,
      });
      mockRun.mockResolvedValueOnce({
        exitCode: 1, stdout: '', stderr: 'stuck', succeeded: false,
      });

      await expect(adapter.resetSync('test-sync')).rejects.toThrow(MutagenError);
    });
  });

  describe('status', () => {
    it('parses template output correctly', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'project-sync|Watching|0|false\nother-sync|Scanning|0|false\nconflict-sync|Watching|3|false\npaused-sync|Watching|0|true',
        stderr: '',
        succeeded: true,
      });

      const statuses = await adapter.status();
      expect(statuses['project-sync']).toBe('watching');
      expect(statuses['other-sync']).toBe('staging');
      expect(statuses['conflict-sync']).toBe('conflicts');
      expect(statuses['paused-sync']).toBe('paused');
    });

    it('maps halted to paused', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'halted-sync|Halted|0|false',
        stderr: '',
        succeeded: true,
      });

      const statuses = await adapter.status();
      expect(statuses['halted-sync']).toBe('paused');
    });

    it('maps unknown status to error', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'broken-sync|unknown_state|0|false',
        stderr: '',
        succeeded: true,
      });

      const statuses = await adapter.status();
      expect(statuses['broken-sync']).toBe('error');
    });

    it('returns empty on failure', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 1, stdout: '', stderr: '', succeeded: false,
      });

      const statuses = await adapter.status();
      expect(Object.keys(statuses).length).toBe(0);
    });

    it('returns empty on empty output', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: '', stderr: '', succeeded: true,
      });

      const statuses = await adapter.status();
      expect(Object.keys(statuses).length).toBe(0);
    });

    it('maps staging statuses correctly', async () => {
      const stagingTypes = ['Staging', 'Transitioning', 'Reconciling', 'Saving'];
      for (const type of stagingTypes) {
        mockRun.mockResolvedValueOnce({
          exitCode: 0,
          stdout: `sync|${type}|0|false`,
          stderr: '',
          succeeded: true,
        });
        const statuses = await adapter.status();
        expect(statuses['sync']).toBe('staging');
      }
    });
  });

  describe('rawStatus', () => {
    it('returns raw output', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Session ID: abc123\nStatus: Watching\nAlpha: /local\nBeta: host:/remote',
        stderr: '',
        succeeded: true,
      });

      const output = await adapter.rawStatus();
      expect(output).toContain('Session ID: abc123');
    });

    it('returns message when no sessions', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0, stdout: '', stderr: '', succeeded: true,
      });

      const output = await adapter.rawStatus();
      expect(output).toBe('No sync sessions running.');
    });
  });

  describe('isAvailable', () => {
    it('returns true when mutagen is found', async () => {
      const available = await adapter.isAvailable();
      expect(available).toBe(true);
    });

    it('returns false when mutagen is not found', async () => {
      mockFindExecutable.mockReturnValueOnce(null);
      const available = await adapter.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('MutagenError', () => {
    it('has correct message for createFailed', () => {
      const err = new MutagenError('createFailed', 'test', 'permission denied');
      expect(err.message).toContain('create');
      expect(err.message).toContain('test');
      expect(err.message).toContain('permission denied');
      expect(err.name).toBe('MutagenError');
      expect(err.code).toBe('createFailed');
    });

    it('has correct message for terminateFailed', () => {
      const err = new MutagenError('terminateFailed', 'test', 'not found');
      expect(err.message).toContain('terminate');
    });

    it('has correct message for resetFailed', () => {
      const err = new MutagenError('resetFailed', '', 'stuck');
      expect(err.message).toContain('reset');
    });

    it('has correct message for flushFailed', () => {
      const err = new MutagenError('flushFailed', '', 'timeout');
      expect(err.message).toContain('flush');
    });
  });

  describe('DEFAULT_IGNORES', () => {
    it('contains expected patterns', () => {
      expect(DEFAULT_IGNORES).toContain('node_modules');
      expect(DEFAULT_IGNORES).toContain('.DS_Store');
      expect(DEFAULT_IGNORES).toContain('target');
      expect(DEFAULT_IGNORES).toContain('.build');
      expect(DEFAULT_IGNORES.length).toBeGreaterThan(10);
    });
  });
});
