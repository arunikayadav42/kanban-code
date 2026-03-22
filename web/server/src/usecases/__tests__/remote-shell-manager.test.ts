import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { deploy, shellOverridePath, remoteDirPath, setupEnvironment } from '../remote-shell-manager.js';

describe('RemoteShellManager', () => {
  const remoteDir = path.join(os.homedir(), '.kanban-code', 'remote');
  const scriptFile = path.join(remoteDir, 'remote-shell.sh');
  const zshLink = path.join(remoteDir, 'zsh');
  const bashLink = path.join(remoteDir, 'bash');

  // Track files created during test for cleanup
  const createdFiles: string[] = [];

  beforeEach(() => {
    createdFiles.length = 0;
  });

  afterEach(() => {
    // Clean up created files (only if they were created by the test)
    for (const f of createdFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  });

  describe('deploy', () => {
    it('creates remote directory if it does not exist', () => {
      // remoteDir may already exist from previous runs, just verify deploy works
      deploy();
      createdFiles.push(scriptFile, zshLink, bashLink);

      expect(fs.existsSync(remoteDir)).toBe(true);
    });

    it('writes remote-shell.sh with executable permissions', () => {
      deploy();
      createdFiles.push(scriptFile, zshLink, bashLink);

      expect(fs.existsSync(scriptFile)).toBe(true);
      const stat = fs.statSync(scriptFile);
      // Check executable bit is set (0o755 = rwxr-xr-x)
      expect(stat.mode & 0o755).toBe(0o755);
    });

    it('creates zsh and bash symlinks pointing to remote-shell.sh', () => {
      deploy();
      createdFiles.push(scriptFile, zshLink, bashLink);

      // Verify symlinks exist
      const zshTarget = fs.readlinkSync(zshLink);
      const bashTarget = fs.readlinkSync(bashLink);
      expect(zshTarget).toBe(scriptFile);
      expect(bashTarget).toBe(scriptFile);
    });

    it('is idempotent -- calling deploy twice succeeds', () => {
      deploy();
      createdFiles.push(scriptFile, zshLink, bashLink);

      // Second call should not throw
      expect(() => deploy()).not.toThrow();
    });

    it('writes script with shebang line', () => {
      deploy();
      createdFiles.push(scriptFile, zshLink, bashLink);

      const content = fs.readFileSync(scriptFile, 'utf-8');
      expect(content.startsWith('#!/bin/bash')).toBe(true);
    });

    it('writes script containing recursion guard', () => {
      deploy();
      createdFiles.push(scriptFile, zshLink, bashLink);

      const content = fs.readFileSync(scriptFile, 'utf-8');
      expect(content).toContain('__KANBAN_REMOTE_WRAPPER');
    });

    it('writes script containing SSH multiplexing options', () => {
      deploy();
      createdFiles.push(scriptFile, zshLink, bashLink);

      const content = fs.readFileSync(scriptFile, 'utf-8');
      expect(content).toContain('ControlMaster=auto');
      expect(content).toContain('ControlPersist=600');
    });

    it('writes script containing mutagen sync setup', () => {
      deploy();
      createdFiles.push(scriptFile, zshLink, bashLink);

      const content = fs.readFileSync(scriptFile, 'utf-8');
      expect(content).toContain('ensure_sync');
      expect(content).toContain('mutagen');
    });

    it('writes script containing worktree fix functions', () => {
      deploy();
      createdFiles.push(scriptFile, zshLink, bashLink);

      const content = fs.readFileSync(scriptFile, 'utf-8');
      expect(content).toContain('__fix_wt');
      expect(content).toContain('__fix_gitlink');
      expect(content).toContain('__relpath');
    });

    it('writes script containing notification cooldown', () => {
      deploy();
      createdFiles.push(scriptFile, zshLink, bashLink);

      const content = fs.readFileSync(scriptFile, 'utf-8');
      expect(content).toContain('NOTIFY_COOLDOWN=300');
    });

    it('writes script that reads from settings.json', () => {
      deploy();
      createdFiles.push(scriptFile, zshLink, bashLink);

      const content = fs.readFileSync(scriptFile, 'utf-8');
      expect(content).toContain('.kanban-code/settings.json');
      expect(content).toContain('REMOTE_HOST');
      expect(content).toContain('REMOTE_DIR');
      expect(content).toContain('LOCAL_MOUNT');
    });
  });

  describe('shellOverridePath', () => {
    it('returns path to zsh symlink in remote directory', () => {
      const result = shellOverridePath();
      expect(result).toBe(path.join(os.homedir(), '.kanban-code', 'remote', 'zsh'));
    });
  });

  describe('remoteDirPath', () => {
    it('returns path to remote directory', () => {
      const result = remoteDirPath();
      expect(result).toBe(path.join(os.homedir(), '.kanban-code', 'remote'));
    });
  });

  describe('setupEnvironment', () => {
    it('returns empty object (script reads config directly)', () => {
      const result = setupEnvironment(
        { host: 'devbox.example.com', remotePath: '/home/user/project', localPath: '/Users/me/project' },
        '/Users/me/project',
      );
      expect(result).toEqual({});
    });
  });
});
