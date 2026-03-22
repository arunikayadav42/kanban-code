import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import OnboardingWizard from '../OnboardingWizard';
import { api } from '../../lib/api-client';

// Mock API client
vi.mock('../../lib/api-client', () => ({
  api: {
    getHealth: vi.fn(),
    patchSettings: vi.fn(),
  },
}));

const mockHealth = {
  status: 'ok' as const,
  dependencies: {
    assistantAvailability: { claude: true, gemini: true, kiro: false },
    hooksInstalled: true,
    pandocAvailable: false,
    wkhtmltoimageAvailable: false,
    pushoverConfigured: false,
    ghAvailable: true,
    ghAuthenticated: true,
    tmuxAvailable: true,
    mutagenAvailable: false,
    assistantHooks: { claude: true, gemini: true, kiro: false },
  },
};

function setupMocks(overrides: {
  assistantAvailability?: Record<string, boolean>;
  [key: string]: unknown;
} = {}) {
  const { assistantAvailability: aaOverride, ...rest } = overrides;
  const mergedDeps = {
    ...mockHealth.dependencies,
    ...rest,
    assistantAvailability: {
      ...mockHealth.dependencies.assistantAvailability,
      ...(aaOverride ?? {}),
    },
  };
  (api.getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...mockHealth,
    dependencies: mergedDeps,
  });
  (api.patchSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});
}

describe('OnboardingWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe('Rendering', () => {
    it('renders the wizard container', async () => {
      render(<OnboardingWizard />);
      expect(screen.getByTestId('onboarding-wizard')).toBeDefined();
    });

    it('starts on Welcome step', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('step-welcome')).toBeDefined();
      });
    });

    it('shows step indicator dots', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('step-indicators')).toBeDefined();
      });
      // Should have multiple dots
      expect(screen.getByTestId('step-dot-0')).toBeDefined();
      expect(screen.getByTestId('step-dot-1')).toBeDefined();
    });
  });

  describe('Welcome step', () => {
    it('shows welcome title and description', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByText('Welcome to Kanban')).toBeDefined();
      });
      expect(screen.getByText(/set up everything you need/)).toBeDefined();
    });

    it('shows Get Started button', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      expect(screen.getByTestId('btn-next').textContent).toBe('Get Started');
    });

    it('does not show Back button on first step', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('step-welcome')).toBeDefined();
      });
      expect(screen.queryByTestId('btn-back')).toBeNull();
    });

    it('does not show Skip button on first step', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('step-welcome')).toBeDefined();
      });
      expect(screen.queryByTestId('btn-skip')).toBeNull();
    });
  });

  describe('Navigation', () => {
    it('navigates to Assistants step on Get Started', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('step-assistants')).toBeDefined();
    });

    it('shows Back button on non-first steps', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('btn-back')).toBeDefined();
    });

    it('shows Skip button on non-first steps', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('btn-skip')).toBeDefined();
    });

    it('navigates back to Welcome from Assistants', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('step-assistants')).toBeDefined();
      fireEvent.click(screen.getByTestId('btn-back'));
      expect(screen.getByTestId('step-welcome')).toBeDefined();
    });

    it('shows Continue button on middle steps', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('btn-next').textContent).toBe('Continue');
    });

    it('can navigate through all steps to Complete', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });

      // Welcome -> Assistants
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('step-assistants')).toBeDefined();

      // Assistants -> Hooks (claude)
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('step-hooks-claude')).toBeDefined();

      // Hooks (claude) -> Hooks (gemini)
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('step-hooks-gemini')).toBeDefined();

      // Hooks (gemini) -> Dependencies
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('step-dependencies')).toBeDefined();

      // Dependencies -> Notifications
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('step-notifications')).toBeDefined();

      // Notifications -> Complete
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('step-complete')).toBeDefined();
    });
  });

  describe('Assistants step', () => {
    it('shows toggles for each assistant', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('assistant-toggle-claude')).toBeDefined();
      expect(screen.getByTestId('assistant-toggle-gemini')).toBeDefined();
    });

    it('shows CLI availability status', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('btn-next'));
      // Both available in our mock
      expect(screen.getAllByText('CLI Available').length).toBeGreaterThanOrEqual(2);
    });

    it('shows install hints when CLI not available', async () => {
      setupMocks({ assistantAvailability: { gemini: false } });
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByText(/npm install -g @google\/gemini-cli/)).toBeDefined();
    });
  });

  describe('Dynamic steps', () => {
    it('skips hook steps for unavailable assistants', async () => {
      setupMocks({ assistantAvailability: { gemini: false } });
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });

      // Welcome -> Assistants
      fireEvent.click(screen.getByTestId('btn-next'));
      // Assistants -> Hooks (claude only, since gemini unavailable)
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('step-hooks-claude')).toBeDefined();

      // Hooks (claude) -> Dependencies (no gemini hooks step)
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('step-dependencies')).toBeDefined();
    });

    it('removes hook step when assistant is toggled off', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });

      // Go to Assistants
      fireEvent.click(screen.getByTestId('btn-next'));

      // Toggle off gemini
      fireEvent.click(screen.getByTestId('assistant-toggle-gemini'));

      // Continue past assistants
      fireEvent.click(screen.getByTestId('btn-next'));
      // Should be claude hooks
      expect(screen.getByTestId('step-hooks-claude')).toBeDefined();

      // Next should be dependencies (no gemini hooks step)
      fireEvent.click(screen.getByTestId('btn-next'));
      expect(screen.getByTestId('step-dependencies')).toBeDefined();
    });
  });

  describe('Dependencies step', () => {
    /** Navigate from Welcome to Dependencies step (steps: 0->1->2->3->4) */
    async function navigateToDeps() {
      fireEvent.click(screen.getByTestId('btn-next')); // 0->1: assistants
      fireEvent.click(screen.getByTestId('btn-skip'));  // 1->2: hooks claude
      fireEvent.click(screen.getByTestId('btn-skip'));  // 2->3: hooks gemini
      fireEvent.click(screen.getByTestId('btn-skip'));  // 3->4: dependencies
    }

    it('shows tmux and gh status', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      await navigateToDeps();
      expect(screen.getByTestId('step-dependencies')).toBeDefined();
      expect(screen.getByText('tmux')).toBeDefined();
      expect(screen.getByText('GitHub CLI (gh)')).toBeDefined();
    });

    it('shows brew install command for missing deps', async () => {
      setupMocks({ tmuxAvailable: false, ghAvailable: false });
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      await navigateToDeps();
      expect(screen.getByText('brew install tmux gh')).toBeDefined();
    });

    it('shows Re-check button', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      await navigateToDeps();
      expect(screen.getByTestId('btn-recheck')).toBeDefined();
    });
  });

  describe('Notifications step', () => {
    async function navigateToNotifications() {
      fireEvent.click(screen.getByTestId('btn-next')); // 0->1: assistants
      fireEvent.click(screen.getByTestId('btn-skip'));  // 1->2: hooks claude
      fireEvent.click(screen.getByTestId('btn-skip'));  // 2->3: hooks gemini
      fireEvent.click(screen.getByTestId('btn-skip'));  // 3->4: dependencies
      fireEvent.click(screen.getByTestId('btn-next'));  // 4->5: notifications
    }

    it('shows Browser Notifications as ready', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      await navigateToNotifications();
      expect(screen.getByText('Browser Notifications')).toBeDefined();
    });

    it('shows Pushover toggle', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      await navigateToNotifications();
      expect(screen.getByTestId('onboard-pushover-toggle')).toBeDefined();
    });

    it('shows token inputs when Pushover enabled', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      await navigateToNotifications();
      fireEvent.click(screen.getByTestId('onboard-pushover-toggle'));
      expect(screen.getByTestId('onboard-pushover-token')).toBeDefined();
      expect(screen.getByTestId('onboard-pushover-user-key')).toBeDefined();
    });
  });

  describe('Complete step', () => {
    /** Navigate from Welcome all the way to Complete (steps: 0->1->2->3->4->5->6) */
    async function navigateToComplete() {
      fireEvent.click(screen.getByTestId('btn-next')); // 0->1: assistants
      fireEvent.click(screen.getByTestId('btn-skip'));  // 1->2: hooks claude
      fireEvent.click(screen.getByTestId('btn-skip'));  // 2->3: hooks gemini
      fireEvent.click(screen.getByTestId('btn-skip'));  // 3->4: dependencies
      fireEvent.click(screen.getByTestId('btn-skip'));  // 4->5: notifications
      fireEvent.click(screen.getByTestId('btn-next'));  // 5->6: complete
    }

    it('shows summary of configuration', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      await navigateToComplete();
      expect(screen.getByTestId('step-complete')).toBeDefined();
      expect(screen.getByText('Setup Complete')).toBeDefined();
    });

    it('shows Done button on final step', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      await navigateToComplete();
      expect(screen.getByTestId('btn-done')).toBeDefined();
    });

    it('calls onComplete and patches settings when Done clicked', async () => {
      const onComplete = vi.fn();
      render(<OnboardingWizard onComplete={onComplete} />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      await navigateToComplete();

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-done'));
      });

      expect(api.patchSettings).toHaveBeenCalledWith({ hasCompletedOnboarding: true });
      expect(onComplete).toHaveBeenCalledOnce();
    });

    it('does not show Back or Skip buttons on Complete step', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('btn-next')).toBeDefined();
      });
      await navigateToComplete();
      // Complete is the last step, so no Next/Skip. Done replaces them.
      expect(screen.queryByTestId('btn-next')).toBeNull();
      expect(screen.queryByTestId('btn-skip')).toBeNull();
    });
  });

  describe('Step indicators', () => {
    it('shows correct number of dots for all assistants available', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('step-indicators')).toBeDefined();
      });
      // Welcome + Assistants + 2 hooks + Dependencies + Notifications + Complete = 7
      expect(screen.getByTestId('step-dot-6')).toBeDefined();
    });

    it('highlights current step dot', async () => {
      render(<OnboardingWizard />);
      await waitFor(() => {
        expect(screen.getByTestId('step-dot-0')).toBeDefined();
      });
      // First dot should be accent color (active)
      const dot = screen.getByTestId('step-dot-0');
      expect(dot.style.backgroundColor).toContain('007AFF');
    });
  });
});
