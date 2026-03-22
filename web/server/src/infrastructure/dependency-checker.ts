import fs from 'fs';
import path from 'path';
import os from 'os';
import { isAvailable, findExecutable, run } from './shell-command.js';
import { getAllAssistants, getDescriptor, getConfigDirName } from '@kanban-code/shared';
import type { SettingsStore } from './settings-store.js';

/**
 * Checks availability of all external dependencies.
 *
 * Swift source: Sources/KanbanCodeCore/Infrastructure/DependencyChecker.swift
 * Spec: Section 7 (Infrastructure), Section 3.3 (GET /api/health)
 */

export interface DependencyStatus {
  /** Dynamic assistant availability keyed by assistant id. */
  assistantAvailability: Record<string, boolean>;
  hooksInstalled: boolean;
  pandocAvailable: boolean;
  wkhtmltoimageAvailable: boolean;
  pushoverConfigured: boolean;
  ghAvailable: boolean;
  ghAuthenticated: boolean;
  tmuxAvailable: boolean;
  mutagenAvailable: boolean;
  assistantHooks: Record<string, boolean>;
}

/**
 * Check all dependencies concurrently.
 */
export async function checkAll(settingsStore: SettingsStore): Promise<DependencyStatus> {
  // Check assistant availability dynamically from registered descriptors
  const assistantAvailability: Record<string, boolean> = {};
  await Promise.all(getAllAssistants().map(async (id) => {
    const desc = getDescriptor(id);
    assistantAvailability[id] = desc ? await isAvailable(desc.availabilityCheck) : false;
  }));

  // Check non-assistant dependencies concurrently
  const [pandoc, wkhtmltoimage, gh, ghAuth, tmux, mutagen] = await Promise.all([
    isAvailable('pandoc'),
    isAvailable('wkhtmltoimage'),
    isAvailable('gh'),
    checkGhAuth(),
    isAvailable('tmux'),
    isAvailable('mutagen'),
  ]);

  // Check hooks for all assistants
  const assistantHooks: Record<string, boolean> = {};
  for (const assistant of getAllAssistants()) {
    assistantHooks[assistant] = isHookInstalled(assistant);
  }

  let pushoverConfigured = false;
  try {
    const settings = settingsStore.read();
    const token = settings.notifications.pushoverToken ?? '';
    const user = settings.notifications.pushoverUserKey ?? '';
    pushoverConfigured = settings.notifications.pushoverEnabled && token.length > 0 && user.length > 0;
  } catch { /* ignore */ }

  return {
    assistantAvailability,
    hooksInstalled: Object.values(assistantHooks).some(v => v),
    assistantHooks,
    pandocAvailable: pandoc,
    wkhtmltoimageAvailable: wkhtmltoimage,
    pushoverConfigured,
    ghAvailable: gh,
    ghAuthenticated: ghAuth,
    tmuxAvailable: tmux,
    mutagenAvailable: mutagen,
  };
}

/**
 * Check if Kanban Code hooks are installed for a given assistant.
 * Uses the descriptor's hooks config to determine the settings path and format.
 * Swift source: HookManager.isInstalled(for:settingsPath:)
 */
function isHookInstalled(assistant: string): boolean {
  const desc = getDescriptor(assistant);
  if (!desc?.hooks) return false;

  const configDir = getConfigDirName(assistant);
  const settingsPath = path.join(os.homedir(), configDir, desc.hooks.configPath);

  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const json = JSON.parse(raw);
    const hooks = json.hooks;
    if (!hooks || typeof hooks !== 'object') return false;

    const requiredEvents = desc.hooks.events;

    if (desc.hooks.configFormat === 'flat') {
      // Flat format (Kiro): { hooks: { event: [{ command }] } }
      return requiredEvents.every(event => {
        const entries = hooks[event];
        if (!Array.isArray(entries)) return false;
        return entries.some((entry: { command?: string }) =>
          entry.command?.includes('.kanban-code/hook.sh'),
        );
      });
    }

    // Nested format (Claude/Gemini): { hooks: { Event: [{ matcher, hooks: [{ type, command }] }] } }
    return requiredEvents.every(event => {
      const entries = hooks[event];
      if (!Array.isArray(entries)) return false;
      return entries.some((entry: { hooks?: Array<{ command?: string }> }) =>
        entry.hooks?.some(h => h.command?.includes('.kanban-code/hook.sh')),
      );
    });
  } catch {
    return false;
  }
}

/** Check if `gh` CLI is authenticated (exit code 0 = logged in). */
async function checkGhAuth(): Promise<boolean> {
  const ghPath = findExecutable('gh');
  if (!ghPath) return false;
  try {
    const result = await run(ghPath, ['auth', 'status']);
    return result.succeeded;
  } catch {
    return false;
  }
}
