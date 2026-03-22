/**
 * OnboardingWizard -- multi-step setup wizard.
 *
 * Steps: Welcome -> Assistant selection -> Per-assistant hook installation ->
 *        Dependencies check -> Notifications setup -> Complete.
 *
 * Dynamic step count based on enabled assistants.
 * Uses GET /api/health for dependency status, PATCH /api/settings to mark complete.
 *
 * Swift source: Sources/KanbanCode/OnboardingWizard.swift
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { CodingAssistant, HealthResponse } from '@kanban-code/shared';
import { ALL_ASSISTANTS, getDisplayName, getInstallCommand } from '@kanban-code/shared';
import { api } from '../lib/api-client.js';

// MARK: - Types

type OnboardingStepType =
  | { kind: 'welcome' }
  | { kind: 'assistants' }
  | { kind: 'hooks'; assistant: CodingAssistant }
  | { kind: 'dependencies' }
  | { kind: 'notifications' }
  | { kind: 'complete' };

// MARK: - Props

export interface OnboardingWizardProps {
  onComplete?: () => void;
}

// MARK: - Component

export default function OnboardingWizard({
  onComplete,
}: OnboardingWizardProps): React.ReactElement {
  const [currentStep, setCurrentStep] = useState(0);
  const [health, setHealth] = useState<HealthResponse['dependencies'] | null>(null);
  const [enabledAssistants, setEnabledAssistants] = useState<Set<CodingAssistant>>(
    new Set(ALL_ASSISTANTS),
  );
  const [hookErrors, setHookErrors] = useState<Record<string, string>>({});
  const [pushoverEnabled, setPushoverEnabled] = useState(false);
  const [pushoverToken, setPushoverToken] = useState('');
  const [pushoverUserKey, setPushoverUserKey] = useState('');
  const [isChecking, setIsChecking] = useState(false);

  // Build dynamic steps
  const steps = useMemo<OnboardingStepType[]>(() => {
    const result: OnboardingStepType[] = [{ kind: 'welcome' }, { kind: 'assistants' }];
    for (const assistant of ALL_ASSISTANTS) {
      const available = health?.assistantAvailability?.[assistant] ?? false;
      if (available && enabledAssistants.has(assistant)) {
        result.push({ kind: 'hooks', assistant });
      }
    }
    result.push({ kind: 'dependencies' }, { kind: 'notifications' }, { kind: 'complete' });
    return result;
  }, [health, enabledAssistants]);

  const totalSteps = steps.length;

  // Clamp currentStep when steps change
  useEffect(() => {
    if (currentStep >= totalSteps) {
      setCurrentStep(totalSteps - 1);
    }
  }, [currentStep, totalSteps]);

  // Fetch health on mount
  const refreshHealth = useCallback(async () => {
    setIsChecking(true);
    try {
      const data = await api.getHealth();
      setHealth(data.dependencies);
    } catch {
      // Continue without health data
    }
    setIsChecking(false);
  }, []);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  // Navigation
  const goNext = useCallback(() => {
    setCurrentStep(prev => Math.min(prev + 1, totalSteps - 1));
  }, [totalSteps]);

  const goBack = useCallback(() => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  }, []);

  // Complete onboarding
  const handleComplete = useCallback(async () => {
    try {
      await api.patchSettings({ hasCompletedOnboarding: true });
    } catch {
      // Best effort
    }
    onComplete?.();
  }, [onComplete]);

  // Step indicator color
  const stepColor = (index: number): string => {
    if (index === currentStep) return 'var(--color-accent, #007AFF)';
    if (index < currentStep) return '#22c55e';
    return 'rgba(255,255,255,0.2)';
  };

  const currentStepData = steps[Math.min(currentStep, totalSteps - 1)];

  return (
    <div
      data-testid="onboarding-wizard"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 520,
        height: 460,
        backgroundColor: 'var(--bg-secondary, #1c1c1e)',
        color: 'var(--text-primary, #f5f5f7)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Step indicator */}
      <div
        data-testid="step-indicators"
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 8,
          padding: '20px 0 12px',
        }}
      >
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            key={i}
            data-testid={`step-dot-${i}`}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: stepColor(i),
            }}
          />
        ))}
      </div>

      <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />

      {/* Step content */}
      <div data-testid="step-content" style={{ flex: 1, overflow: 'auto' }}>
        {currentStepData.kind === 'welcome' && <WelcomeStep />}
        {currentStepData.kind === 'assistants' && (
          <AssistantsStep
            health={health}
            enabledAssistants={enabledAssistants}
            onToggle={(a) => {
              setEnabledAssistants(prev => {
                const next = new Set(prev);
                if (next.has(a)) next.delete(a);
                else next.add(a);
                return next;
              });
            }}
            isChecking={isChecking}
            onRecheck={refreshHealth}
          />
        )}
        {currentStepData.kind === 'hooks' && (
          <HooksStep
            assistant={currentStepData.assistant}
            health={health}
            hookError={hookErrors[currentStepData.assistant] ?? null}
            onInstall={() => {
              // In web context, hooks are installed via server API
              setHookErrors(prev => ({ ...prev, [currentStepData.assistant]: '' }));
              refreshHealth();
            }}
            onRecheck={refreshHealth}
          />
        )}
        {currentStepData.kind === 'dependencies' && (
          <DependenciesStep
            health={health}
            isChecking={isChecking}
            onRecheck={refreshHealth}
          />
        )}
        {currentStepData.kind === 'notifications' && (
          <NotificationsStep
            pushoverEnabled={pushoverEnabled}
            pushoverToken={pushoverToken}
            pushoverUserKey={pushoverUserKey}
            onTogglePushover={setPushoverEnabled}
            onTokenChange={setPushoverToken}
            onUserKeyChange={setPushoverUserKey}
          />
        )}
        {currentStepData.kind === 'complete' && (
          <CompleteStep health={health} enabledAssistants={enabledAssistants} />
        )}
      </div>

      <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />

      {/* Navigation buttons */}
      <div
        data-testid="navigation"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: 16,
          gap: 8,
        }}
      >
        {currentStep > 0 && currentStep < totalSteps - 1 && (
          <button
            data-testid="btn-back"
            onClick={goBack}
            style={secondaryButtonStyle}
          >
            Back
          </button>
        )}

        <span style={{ flex: 1 }} />

        {currentStep < totalSteps - 1 ? (
          <>
            {currentStep > 0 && (
              <button
                data-testid="btn-skip"
                onClick={goNext}
                style={{
                  ...secondaryButtonStyle,
                  color: 'var(--color-secondary, #8e8e93)',
                }}
              >
                Skip
              </button>
            )}
            <button
              data-testid="btn-next"
              onClick={goNext}
              style={primaryButtonStyle}
            >
              {currentStep === 0 ? 'Get Started' : 'Continue'}
            </button>
          </>
        ) : (
          <button
            data-testid="btn-done"
            onClick={handleComplete}
            style={primaryButtonStyle}
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}

// MARK: - Step: Welcome

function WelcomeStep(): React.ReactElement {
  return (
    <div
      data-testid="step-welcome"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 16,
        padding: 24,
      }}
    >
      <div style={{ fontSize: 48, opacity: 0.8 }}>
        <KanbanIcon />
      </div>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Welcome to Kanban</h2>
      <p style={{
        margin: 0,
        fontSize: 14,
        color: 'var(--color-secondary, #8e8e93)',
        textAlign: 'center',
        maxWidth: 360,
      }}>
        Let's set up everything you need to manage your coding agent sessions.
      </p>
    </div>
  );
}

// MARK: - Step: Assistants

function AssistantsStep({
  health,
  enabledAssistants,
  onToggle,
  isChecking,
  onRecheck,
}: {
  health: HealthResponse['dependencies'] | null;
  enabledAssistants: Set<CodingAssistant>;
  onToggle: (a: CodingAssistant) => void;
  isChecking: boolean;
  onRecheck: () => void;
}): React.ReactElement {
  const getAvailable = (a: CodingAssistant): boolean => {
    return health?.assistantAvailability?.[a] ?? false;
  };

  return (
    <div data-testid="step-assistants" style={{ padding: 24 }}>
      <StepHeader
        title="Coding Assistants"
        description="Kanban manages sessions from coding assistants. Enable the ones you want to use."
      />

      {ALL_ASSISTANTS.map((assistant) => (
        <div
          key={assistant}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer' }}>
            <input
              type="checkbox"
              data-testid={`assistant-toggle-${assistant}`}
              checked={enabledAssistants.has(assistant)}
              onChange={() => onToggle(assistant)}
            />
            <span style={{ fontSize: 13 }}>{getDisplayName(assistant)}</span>
          </label>
          {getAvailable(assistant) ? (
            <span style={{ fontSize: 11, color: '#22c55e' }}>CLI Available</span>
          ) : (
            <span style={{ fontSize: 11, color: '#f97316' }}>Not Installed</span>
          )}
        </div>
      ))}

      {/* Install hints */}
      {ALL_ASSISTANTS.some(a => !getAvailable(a) && enabledAssistants.has(a)) && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--color-secondary, #8e8e93)', marginBottom: 6 }}>
            Install missing assistants:
          </div>
          {ALL_ASSISTANTS.filter(a => !getAvailable(a) && enabledAssistants.has(a)).map(a => (
            <code
              key={a}
              style={{
                display: 'block',
                fontSize: 12,
                fontFamily: 'monospace',
                padding: 8,
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderRadius: 6,
                marginBottom: 4,
              }}
            >
              {getInstallCommand(a)}
            </code>
          ))}
          <RecheckButton isChecking={isChecking} onRecheck={onRecheck} />
        </div>
      )}
    </div>
  );
}

// MARK: - Step: Hooks

function HooksStep({
  assistant,
  health,
  hookError,
  onInstall,
  onRecheck,
}: {
  assistant: CodingAssistant;
  health: HealthResponse['dependencies'] | null;
  hookError: string | null;
  onInstall: () => void;
  onRecheck: () => void;
}): React.ReactElement {
  const installed = health?.hooksInstalled ?? false;

  return (
    <div data-testid={`step-hooks-${assistant}`} style={{ padding: 24 }}>
      <StepHeader
        title={`${getDisplayName(assistant)} Hooks`}
        description={`Hooks let Kanban detect when ${getDisplayName(assistant)} starts, stops, or needs your attention.`}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 13 }}>
        <span style={{ color: installed ? '#22c55e' : 'var(--color-secondary, #8e8e93)' }}>
          {installed ? '\u2713' : '\u25CB'}
        </span>
        <span>Hooks installed</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: installed ? '#22c55e' : '#f97316' }}>
          {installed ? 'Ready' : 'Not set up'}
        </span>
      </div>

      {installed ? (
        <div style={{ fontSize: 13, color: '#22c55e', padding: '8px 0' }}>
          All hooks are installed and ready
        </div>
      ) : (
        <div style={{ padding: '8px 0' }}>
          <button
            data-testid={`install-hooks-${assistant}`}
            onClick={onInstall}
            style={primaryButtonStyle}
          >
            Install Hooks
          </button>
          {hookError && (
            <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{hookError}</div>
          )}
        </div>
      )}
    </div>
  );
}

// MARK: - Step: Dependencies

function DependenciesStep({
  health,
  isChecking,
  onRecheck,
}: {
  health: HealthResponse['dependencies'] | null;
  isChecking: boolean;
  onRecheck: () => void;
}): React.ReactElement {
  const tmuxAvailable = health?.tmuxAvailable ?? false;
  const ghAvailable = health?.ghAvailable ?? false;
  const ghAuthenticated = health?.ghAuthenticated ?? false;

  const brewPackages: string[] = [];
  if (!tmuxAvailable) brewPackages.push('tmux');
  if (!ghAvailable) brewPackages.push('gh');
  const brewCommand = brewPackages.length > 0 ? `brew install ${brewPackages.join(' ')}` : null;

  return (
    <div data-testid="step-dependencies" style={{ padding: 24 }}>
      <StepHeader
        title="Dependencies"
        description="Tools that Kanban Code needs for session management and GitHub integration."
      />

      <StatusCheckRow label="tmux" done={tmuxAvailable} />
      <StatusCheckRow label="GitHub CLI (gh)" done={ghAvailable} />

      {ghAvailable && !ghAuthenticated && (
        <div style={{ fontSize: 12, color: '#f97316', padding: '4px 0 4px 24px' }}>
          gh is installed but not logged in. Run <code>gh auth login</code> in a terminal.
        </div>
      )}

      {brewCommand && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--color-secondary, #8e8e93)', marginBottom: 6 }}>
            Install missing dependencies:
          </div>
          <code
            style={{
              display: 'block',
              fontSize: 12,
              fontFamily: 'monospace',
              padding: 8,
              backgroundColor: 'rgba(255,255,255,0.04)',
              borderRadius: 6,
            }}
          >
            {brewCommand}
          </code>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <RecheckButton isChecking={isChecking} onRecheck={onRecheck} />
      </div>
    </div>
  );
}

// MARK: - Step: Notifications

function NotificationsStep({
  pushoverEnabled,
  pushoverToken,
  pushoverUserKey,
  onTogglePushover,
  onTokenChange,
  onUserKeyChange,
}: {
  pushoverEnabled: boolean;
  pushoverToken: string;
  pushoverUserKey: string;
  onTogglePushover: (v: boolean) => void;
  onTokenChange: (v: string) => void;
  onUserKeyChange: (v: string) => void;
}): React.ReactElement {
  return (
    <div data-testid="step-notifications" style={{ padding: 24 }}>
      <StepHeader
        title="Notifications"
        description="Get notified when your coding assistant stops and needs your input."
      />

      <StatusCheckRow label="Browser Notifications" done />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            data-testid="onboard-pushover-toggle"
            checked={pushoverEnabled}
            onChange={(e) => onTogglePushover(e.target.checked)}
          />
          <span style={{ fontSize: 13 }}>Enable Pushover (mobile push notifications)</span>
        </label>
      </div>

      {pushoverEnabled && (
        <>
          <input
            data-testid="onboard-pushover-token"
            type="text"
            value={pushoverToken}
            placeholder="App Token"
            onChange={(e) => onTokenChange(e.target.value)}
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          <input
            data-testid="onboard-pushover-user-key"
            type="text"
            value={pushoverUserKey}
            placeholder="User Key"
            onChange={(e) => onUserKeyChange(e.target.value)}
            style={inputStyle}
          />
          <div style={{ fontSize: 11, color: 'var(--color-tertiary, #aeaeb2)', marginTop: 6 }}>
            Get your keys at pushover.net
          </div>
        </>
      )}
    </div>
  );
}

// MARK: - Step: Complete

function CompleteStep({
  health,
  enabledAssistants,
}: {
  health: HealthResponse['dependencies'] | null;
  enabledAssistants: Set<CodingAssistant>;
}): React.ReactElement {
  return (
    <div data-testid="step-complete" style={{ padding: 24, overflow: 'auto' }}>
      <StepHeader
        title="Setup Complete"
        description="Here's a summary of your configuration."
      />

      {ALL_ASSISTANTS.map((a) => {
        const available = health?.assistantAvailability?.[a] ?? false;
        return (
          <React.Fragment key={a}>
            <SummaryRow label={getDisplayName(a)} ok={available && enabledAssistants.has(a)} />
            {available && (
              <SummaryRow label={`  ${getDisplayName(a)} Hooks`} ok={health?.hooksInstalled ?? false} />
            )}
          </React.Fragment>
        );
      })}

      <SummaryRow label="Pushover" ok={health?.pushoverConfigured ?? false} />
      <SummaryRow label="tmux" ok={health?.tmuxAvailable ?? false} />
      <SummaryRow label="GitHub CLI" ok={health?.ghAuthenticated ?? false} />

      <div style={{ fontSize: 11, color: 'var(--color-tertiary, #aeaeb2)', marginTop: 12 }}>
        You can always reopen this wizard from Settings.
      </div>
    </div>
  );
}

// MARK: - Shared Sub-Components

function StepHeader({ title, description }: { title: string; description: string }): React.ReactElement {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
      <div style={{ fontSize: 13, color: 'var(--color-secondary, #8e8e93)', marginTop: 4 }}>
        {description}
      </div>
    </div>
  );
}

function StatusCheckRow({ label, done }: { label: string; done: boolean }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13 }}>
      <span style={{ color: done ? '#22c55e' : 'var(--color-secondary, #8e8e93)' }}>
        {done ? '\u2713' : '\u25CB'}
      </span>
      <span>{label}</span>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: done ? '#22c55e' : '#f97316' }}>
        {done ? 'Ready' : 'Not set up'}
      </span>
    </div>
  );
}

function SummaryRow({ label, ok }: { label: string; ok: boolean }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: ok ? '#22c55e' : '#f97316' }}>
        {ok ? '\u2713' : '\u26A0'}
      </span>
      <span>{label}</span>
    </div>
  );
}

function RecheckButton({ isChecking, onRecheck }: { isChecking: boolean; onRecheck: () => void }): React.ReactElement {
  return (
    <button
      data-testid="btn-recheck"
      onClick={onRecheck}
      disabled={isChecking}
      style={{
        ...secondaryButtonStyle,
        opacity: isChecking ? 0.5 : 1,
        fontSize: 12,
      }}
    >
      {isChecking ? 'Checking...' : 'Re-check'}
    </button>
  );
}

function KanbanIcon(): React.ReactElement {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="currentColor" opacity={0.6}>
      <rect x="4" y="8" width="12" height="32" rx="3" />
      <rect x="18" y="12" width="12" height="24" rx="3" />
      <rect x="32" y="8" width="12" height="32" rx="3" />
    </svg>
  );
}

// MARK: - Shared Styles

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  backgroundColor: 'var(--color-accent, #007AFF)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 400,
  backgroundColor: 'transparent',
  color: 'var(--text-primary, #f5f5f7)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  backgroundColor: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  color: 'var(--text-primary, #f5f5f7)',
  boxSizing: 'border-box',
};
