import { describe, it, expect, beforeEach } from 'vitest';
import type { AssistantDescriptor } from '../types/assistant-descriptor.js';
import {
  CodingAssistant,
  getDisplayName,
  getShortDisplayName,
  getCliCommand,
  getPromptCharacter,
  getAutoApproveFlag,
  getResumeFlag,
  getSupportsWorktree,
  getSupportsImageUpload,
  getConfigDirName,
  getHistoryPromptSymbol,
  getInstallCommand,
  getHealthAvailableKey,
  getNeedsRemotePathOverride,
  ALL_ASSISTANTS,
  registerDescriptors,
  getAllAssistants,
  getDescriptor,
} from '../types/coding-assistant.js';

/** The three built-in descriptors used by all tests. */
const BUILTIN_DESCRIPTORS: AssistantDescriptor[] = [
  {
    id: 'claude',
    displayName: 'Claude Code',
    shortName: 'Claude',
    cliCommand: 'claude',
    availabilityCheck: 'claude',
    promptCharacter: '\u276F',
    autoApproveFlag: '--dangerously-skip-permissions',
    resumeFlag: '--resume',
    supportsWorktree: true,
    supportsImageUpload: true,
    configDirName: '.claude',
    historySymbol: '\u276F',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    needsRemotePathOverride: false,
    usesPasteInput: false,
    readyTimeoutMs: 30_000,
    hooks: {
      events: ['Stop', 'Notification', 'SessionStart', 'SessionEnd', 'UserPromptSubmit'],
      configPath: 'settings.json',
      configFormat: 'nested',
      normalize: {},
    },
    icon: { svgPath: 'M3 3h10v10H3z', viewBox: '0 0 16 16' },
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    shortName: 'Gemini',
    cliCommand: 'gemini',
    availabilityCheck: 'gemini',
    promptCharacter: 'Type your message',
    autoApproveFlag: '--yolo',
    resumeFlag: '--resume',
    supportsWorktree: false,
    supportsImageUpload: false,
    configDirName: '.gemini',
    historySymbol: '\u2726',
    installCommand: 'npm install -g @google/gemini-cli',
    needsRemotePathOverride: true,
    usesPasteInput: true,
    readyTimeoutMs: 60_000,
    hooks: {
      events: ['AfterAgent', 'Notification', 'SessionStart', 'SessionEnd', 'BeforeAgent'],
      configPath: 'settings.json',
      configFormat: 'nested',
      normalize: { AfterAgent: 'Stop', BeforeAgent: 'UserPromptSubmit' },
    },
    icon: { svgPath: 'M8 1l2.5 5 5.5.8-4 3.9.9 5.3L8 13.5 3.1 16l.9-5.3L0 6.8l5.5-.8z', viewBox: '0 0 16 16' },
  },
  {
    id: 'kiro',
    displayName: 'Kiro CLI',
    shortName: 'Kiro',
    cliCommand: 'kiro-cli chat --agent default',
    availabilityCheck: 'kiro-cli',
    promptCharacter: '> ',
    autoApproveFlag: '--trust-all-tools',
    resumeFlag: '--resume',
    supportsWorktree: false,
    supportsImageUpload: true,
    configDirName: '.kiro',
    historySymbol: '>',
    installCommand: 'curl -fsSL https://cli.kiro.dev/install | bash',
    needsRemotePathOverride: false,
    usesPasteInput: false,
    readyTimeoutMs: 30_000,
    hooks: {
      events: ['stop', 'userPromptSubmit', 'agentSpawn'],
      configPath: 'agents/default.json',
      configFormat: 'flat',
      normalize: { agentSpawn: 'SessionStart', stop: 'Stop', userPromptSubmit: 'UserPromptSubmit' },
    },
    icon: { svgPath: 'M13 3L4 14h5l-1 7 9-11h-5l1-7z', viewBox: '0 0 24 24' },
  },
];

describe('CodingAssistant', () => {
  beforeEach(() => {
    registerDescriptors(BUILTIN_DESCRIPTORS);
  });

  describe('enum values', () => {
    it('has claude, gemini, and kiro', () => {
      expect(ALL_ASSISTANTS).toEqual(['claude', 'gemini', 'kiro']);
    });

    it('values are JSON-serializable strings', () => {
      const claude: CodingAssistant = 'claude';
      const gemini: CodingAssistant = 'gemini';
      const kiro: CodingAssistant = 'kiro';
      expect(JSON.parse(JSON.stringify(claude))).toBe('claude');
      expect(JSON.parse(JSON.stringify(gemini))).toBe('gemini');
      expect(JSON.parse(JSON.stringify(kiro))).toBe('kiro');
    });
  });

  describe('displayName', () => {
    it('claude -> "Claude Code"', () => {
      expect(getDisplayName('claude')).toBe('Claude Code');
    });
    it('gemini -> "Gemini CLI"', () => {
      expect(getDisplayName('gemini')).toBe('Gemini CLI');
    });
    it('kiro -> "Kiro CLI"', () => {
      expect(getDisplayName('kiro')).toBe('Kiro CLI');
    });
  });

  describe('shortDisplayName', () => {
    it('claude -> "Claude"', () => {
      expect(getShortDisplayName('claude')).toBe('Claude');
    });
    it('gemini -> "Gemini"', () => {
      expect(getShortDisplayName('gemini')).toBe('Gemini');
    });
    it('kiro -> "Kiro"', () => {
      expect(getShortDisplayName('kiro')).toBe('Kiro');
    });
  });

  describe('cliCommand', () => {
    it('claude -> "claude"', () => {
      expect(getCliCommand('claude')).toBe('claude');
    });
    it('gemini -> "gemini"', () => {
      expect(getCliCommand('gemini')).toBe('gemini');
    });
    it('kiro -> "kiro-cli chat --agent default"', () => {
      expect(getCliCommand('kiro')).toBe('kiro-cli chat --agent default');
    });
  });

  describe('promptCharacter', () => {
    it('claude -> "\u276F"', () => {
      expect(getPromptCharacter('claude')).toBe('\u276F');
    });
    it('gemini -> "Type your message"', () => {
      expect(getPromptCharacter('gemini')).toBe('Type your message');
    });
    it('kiro -> "> "', () => {
      expect(getPromptCharacter('kiro')).toBe('> ');
    });
  });

  describe('autoApproveFlag', () => {
    it('claude -> "--dangerously-skip-permissions"', () => {
      expect(getAutoApproveFlag('claude')).toBe('--dangerously-skip-permissions');
    });
    it('gemini -> "--yolo"', () => {
      expect(getAutoApproveFlag('gemini')).toBe('--yolo');
    });
    it('kiro -> "--trust-all-tools"', () => {
      expect(getAutoApproveFlag('kiro')).toBe('--trust-all-tools');
    });
  });

  describe('resumeFlag', () => {
    it('claude uses "--resume"', () => {
      expect(getResumeFlag('claude')).toBe('--resume');
    });
    it('gemini uses "--resume"', () => {
      expect(getResumeFlag('gemini')).toBe('--resume');
    });
    it('kiro uses "--resume"', () => {
      expect(getResumeFlag('kiro')).toBe('--resume');
    });
  });

  describe('supportsWorktree', () => {
    it('claude supports worktrees', () => {
      expect(getSupportsWorktree('claude')).toBe(true);
    });
    it('gemini does not support worktrees', () => {
      expect(getSupportsWorktree('gemini')).toBe(false);
    });
    it('kiro does not support worktrees', () => {
      expect(getSupportsWorktree('kiro')).toBe(false);
    });
  });

  describe('supportsImageUpload', () => {
    it('claude supports image upload', () => {
      expect(getSupportsImageUpload('claude')).toBe(true);
    });
    it('gemini does not support image upload', () => {
      expect(getSupportsImageUpload('gemini')).toBe(false);
    });
    it('kiro supports image upload', () => {
      expect(getSupportsImageUpload('kiro')).toBe(true);
    });
  });

  describe('configDirName', () => {
    it('claude -> ".claude"', () => {
      expect(getConfigDirName('claude')).toBe('.claude');
    });
    it('gemini -> ".gemini"', () => {
      expect(getConfigDirName('gemini')).toBe('.gemini');
    });
    it('kiro -> ".kiro"', () => {
      expect(getConfigDirName('kiro')).toBe('.kiro');
    });
  });

  describe('historyPromptSymbol', () => {
    it('claude -> "\u276F"', () => {
      expect(getHistoryPromptSymbol('claude')).toBe('\u276F');
    });
    it('gemini -> "\u2726"', () => {
      expect(getHistoryPromptSymbol('gemini')).toBe('\u2726');
    });
    it('kiro -> ">"', () => {
      expect(getHistoryPromptSymbol('kiro')).toBe('>');
    });
  });

  describe('installCommand', () => {
    it('claude -> npm install -g @anthropic-ai/claude-code', () => {
      expect(getInstallCommand('claude')).toBe('npm install -g @anthropic-ai/claude-code');
    });
    it('gemini -> npm install -g @google/gemini-cli', () => {
      expect(getInstallCommand('gemini')).toBe('npm install -g @google/gemini-cli');
    });
    it('kiro -> curl install script', () => {
      expect(getInstallCommand('kiro')).toBe('curl -fsSL https://cli.kiro.dev/install | bash');
    });
  });

  describe('healthAvailableKey', () => {
    it('claude -> "claudeAvailable"', () => {
      expect(getHealthAvailableKey('claude')).toBe('claudeAvailable');
    });
    it('gemini -> "geminiAvailable"', () => {
      expect(getHealthAvailableKey('gemini')).toBe('geminiAvailable');
    });
    it('kiro -> "kiroAvailable"', () => {
      expect(getHealthAvailableKey('kiro')).toBe('kiroAvailable');
    });
  });

  describe('descriptor registry', () => {
    it('getAllAssistants returns registered IDs', () => {
      expect(getAllAssistants()).toEqual(['claude', 'gemini', 'kiro']);
    });

    it('getDescriptor returns full descriptor', () => {
      const desc = getDescriptor('claude');
      expect(desc).toBeDefined();
      expect(desc!.id).toBe('claude');
      expect(desc!.displayName).toBe('Claude Code');
      expect(desc!.supportsWorktree).toBe(true);
    });

    it('getDescriptor returns undefined for unknown assistant', () => {
      expect(getDescriptor('unknown-ai')).toBeUndefined();
    });

    it('unknown assistant falls back to sensible defaults', () => {
      expect(getDisplayName('future-ai')).toBe('future-ai');
      expect(getCliCommand('future-ai')).toBe('future-ai');
      expect(getConfigDirName('future-ai')).toBe('.future-ai');
      expect(getSupportsWorktree('future-ai')).toBe(false);
      expect(getHealthAvailableKey('future-ai')).toBe('future-aiAvailable');
    });

    it('registerDescriptors replaces registry and updates ALL_ASSISTANTS', () => {
      registerDescriptors([
        {
          id: 'custom-ai',
          displayName: 'Custom AI',
          shortName: 'Custom',
          cliCommand: 'custom',
          availabilityCheck: 'custom',
          promptCharacter: '$',
          autoApproveFlag: '--yes',
          resumeFlag: '--continue',
          supportsWorktree: true,
          supportsImageUpload: false,
          configDirName: '.custom-ai',
          historySymbol: '$',
          installCommand: 'pip install custom-ai',
          needsRemotePathOverride: false,
          usesPasteInput: false,
          readyTimeoutMs: 30_000,
          hooks: { events: [], configPath: '', configFormat: 'nested', normalize: {} },
          icon: { svgPath: '' },
        },
      ]);

      expect(ALL_ASSISTANTS).toEqual(['custom-ai']);
      expect(getDisplayName('custom-ai')).toBe('Custom AI');
      // Previous entries are cleared
      expect(getDescriptor('claude')).toBeUndefined();

      // Restore for other tests
      registerDescriptors(BUILTIN_DESCRIPTORS);
    });
  });

  describe('needsRemotePathOverride', () => {
    it('claude does not need remote path override', () => {
      expect(getNeedsRemotePathOverride('claude')).toBe(false);
    });
    it('gemini needs remote path override', () => {
      expect(getNeedsRemotePathOverride('gemini')).toBe(true);
    });
    it('kiro does not need remote path override', () => {
      expect(getNeedsRemotePathOverride('kiro')).toBe(false);
    });
  });
});
