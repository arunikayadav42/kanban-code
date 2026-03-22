import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import SettingsView from '../SettingsView';
import { api } from '../../lib/api-client';

// Mock API client
vi.mock('../../lib/api-client', () => ({
  api: {
    getSettings: vi.fn(),
    patchSettings: vi.fn(),
    getHealth: vi.fn(),
    getProjects: vi.fn().mockResolvedValue({ projects: [] }),
    hideProject: vi.fn().mockResolvedValue({ hidden: true }),
    unhideProject: vi.fn().mockResolvedValue({ hidden: false }),
  },
  getApiBase: vi.fn().mockReturnValue('/api'),
}));

const mockSettings = {
  projects: [
    { path: '/Users/dev/my-app', name: 'my-app', visible: true },
    { path: '/Users/dev/api', name: 'api', visible: true, githubFilter: 'is:open' },
  ],
  enabledAssistants: ['claude', 'gemini'],
  notifications: {
    pushoverEnabled: false,
    pushoverToken: null,
    pushoverUserKey: null,
    renderMarkdownImage: false,
  },
  remote: null,
  github: {
    defaultFilter: '',
    pollInterval: 60,
    mergeCommand: 'gh pr merge ${number} --squash --delete-branch',
  },
  globalView: { excludedPaths: [] },
  appearance: { uiTextSize: 1, sessionDetailFontSize: 12 },
};

const mockHealth = {
  status: 'ok' as const,
  dependencies: {
    assistantAvailability: { claude: true, gemini: false, kiro: false },
    hooksInstalled: true,
    pandocAvailable: false,
    wkhtmltoimageAvailable: false,
    pushoverConfigured: false,
    ghAvailable: true,
    ghAuthenticated: true,
    tmuxAvailable: true,
    mutagenAvailable: false,
    assistantHooks: { claude: true, gemini: false, kiro: false },
  },
};

function setupMocks() {
  (api.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
  (api.getHealth as ReturnType<typeof vi.fn>).mockResolvedValue(mockHealth);
  (api.getProjects as ReturnType<typeof vi.fn>).mockResolvedValue({ projects: mockSettings.projects });
  (api.patchSettings as ReturnType<typeof vi.fn>).mockImplementation(
    async (patch) => ({ ...mockSettings, ...patch }),
  );
}

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe('Loading', () => {
    it('shows loading state initially', () => {
      // Make the API hang
      (api.getSettings as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
      (api.getHealth as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
      render(<SettingsView />);
      expect(screen.getByTestId('settings-loading')).toBeDefined();
    });

    it('loads and renders settings', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      expect(screen.getByTestId('settings-view')).toBeDefined();
    });
  });

  describe('Tab navigation', () => {
    it('renders all 5 tabs', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      expect(screen.getByTestId('settings-tab-projects')).toBeDefined();
      expect(screen.getByTestId('settings-tab-assistants')).toBeDefined();
      expect(screen.getByTestId('settings-tab-general')).toBeDefined();
      expect(screen.getByTestId('settings-tab-notifications')).toBeDefined();
      expect(screen.getByTestId('settings-tab-remote')).toBeDefined();
    });

    it('defaults to Projects tab', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      expect(screen.getByTestId('settings-projects')).toBeDefined();
    });

    it('switches to Assistants tab on click', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-assistants'));
      expect(screen.getByTestId('settings-assistants')).toBeDefined();
    });

    it('switches to General tab on click', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-general'));
      expect(screen.getByTestId('settings-general')).toBeDefined();
    });

    it('switches to Notifications tab on click', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-notifications'));
      expect(screen.getByTestId('settings-notifications')).toBeDefined();
    });

    it('switches to Remote tab on click', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-remote'));
      expect(screen.getByTestId('settings-remote')).toBeDefined();
    });
  });

  describe('Projects section', () => {
    it('lists configured projects', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      expect(screen.getByText('my-app')).toBeDefined();
      expect(screen.getByText('api')).toBeDefined();
    });

    it('shows project paths', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      expect(screen.getByText('/Users/dev/my-app')).toBeDefined();
      expect(screen.getByText('/Users/dev/api')).toBeDefined();
    });

    it('shows GitHub filter on projects that have one', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      expect(screen.getByText('gh: is:open')).toBeDefined();
    });

    it('can remove a project', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      const removeBtn = screen.getByTestId('remove-project-/Users/dev/my-app');
      await act(async () => {
        fireEvent.click(removeBtn);
      });
      expect(api.patchSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: [mockSettings.projects[1]],
        }),
      );
    });

    it('can add a project via text input', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      const input = screen.getByTestId('add-project-input');
      const addBtn = screen.getByTestId('add-project-button');

      fireEvent.change(input, { target: { value: '/Users/dev/new-project' } });
      await act(async () => {
        fireEvent.click(addBtn);
      });

      expect(api.patchSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: expect.arrayContaining([
            expect.objectContaining({ path: '/Users/dev/new-project', name: 'new-project' }),
          ]),
        }),
      );
    });
  });

  describe('Assistants section', () => {
    it('shows Claude and Gemini toggles', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-assistants'));
      expect(screen.getByTestId('toggle-claude')).toBeDefined();
      expect(screen.getByTestId('toggle-gemini')).toBeDefined();
    });

    it('shows CLI availability status', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-assistants'));
      expect(screen.getByTestId('status-claude').textContent).toContain('CLI Available');
      expect(screen.getByTestId('status-gemini').textContent).toContain('Not Installed');
    });

    it('shows install command for missing CLIs', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-assistants'));
      expect(screen.getByText(/npm install -g @google\/gemini-cli/)).toBeDefined();
    });

    it('toggles an assistant and saves', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-assistants'));

      await act(async () => {
        fireEvent.click(screen.getByTestId('toggle-gemini'));
      });

      expect(api.patchSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          enabledAssistants: ['claude'],
        }),
      );
    });
  });

  describe('General section', () => {
    it('shows appearance controls', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-general'));
      expect(screen.getByTestId('ui-text-size')).toBeDefined();
      expect(screen.getByTestId('font-size-slider')).toBeDefined();
    });

    it('shows integration status', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-general'));
      expect(screen.getByText('tmux')).toBeDefined();
      expect(screen.getByText('GitHub CLI (gh)')).toBeDefined();
    });

    it('shows merge command input', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-general'));
      const input = screen.getByTestId('merge-command-input') as HTMLInputElement;
      expect(input.value).toContain('gh pr merge');
    });
  });

  describe('Notifications section', () => {
    it('shows Pushover toggle', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-notifications'));
      expect(screen.getByTestId('pushover-enabled')).toBeDefined();
    });

    it('shows token inputs when Pushover enabled', async () => {
      (api.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockSettings,
        notifications: { ...mockSettings.notifications, pushoverEnabled: true },
      });
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-notifications'));
      expect(screen.getByTestId('pushover-token')).toBeDefined();
      expect(screen.getByTestId('pushover-user-key')).toBeDefined();
    });

    it('hides token inputs when Pushover disabled', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-notifications'));
      expect(screen.queryByTestId('pushover-token')).toBeNull();
    });
  });

  describe('Remote section', () => {
    it('shows SSH input fields', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-remote'));
      expect(screen.getByTestId('remote-host')).toBeDefined();
      expect(screen.getByTestId('remote-path')).toBeDefined();
      expect(screen.getByTestId('local-path')).toBeDefined();
    });

    it('shows sync ignores textarea', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('settings-tab-remote'));
      expect(screen.getByTestId('sync-ignores')).toBeDefined();
    });
  });

  describe('Close button', () => {
    it('renders Done button when onClose provided', async () => {
      const onClose = vi.fn();
      render(<SettingsView onClose={onClose} />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      const btn = screen.getByTestId('settings-close');
      fireEvent.click(btn);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not render Done button without onClose', async () => {
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      expect(screen.queryByTestId('settings-close')).toBeNull();
    });
  });

  describe('Error handling', () => {
    it('shows error when API fails', async () => {
      (api.getSettings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
      render(<SettingsView />);
      await waitFor(() => {
        expect(screen.queryByTestId('settings-loading')).toBeNull();
      });
      expect(screen.getByTestId('settings-error')).toBeDefined();
    });
  });
});
