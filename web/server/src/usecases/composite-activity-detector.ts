import type { ActivityState } from '@kanban-code/shared';
import { getActivityPriority } from '@kanban-code/shared';
import type { ActivityDetector, HookEvent } from '../domain/ports/activity-detector.js';
import type { CodingAssistantRegistry } from './coding-assistant-registry.js';

/**
 * An ActivityDetector implementation that routes operations to the correct
 * assistant-specific detector via the registry. Hook events are forwarded to
 * all registered detectors. Polling and state queries fan out to all registered
 * detectors and merge results, keeping the highest-priority state per session.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/CompositeActivityDetector.swift
 */
export class CompositeActivityDetector implements ActivityDetector {
  constructor(private readonly registry: CodingAssistantRegistry) {}

  /**
   * Forward hook events to all registered detectors.
   * Each detector normalizes event names internally (e.g. Gemini's AfterAgent -> Stop),
   * so events from one assistant are harmless to another's detector.
   */
  async handleHookEvent(event: HookEvent): Promise<void> {
    for (const assistant of this.registry.available) {
      const detector = this.registry.detector(assistant);
      if (detector) {
        await detector.handleHookEvent(event);
      }
    }
  }

  /** Poll all registered detectors and merge results. */
  async pollActivity(sessionPaths: Record<string, string>): Promise<Record<string, ActivityState>> {
    const merged: Record<string, ActivityState> = {};

    for (const assistant of this.registry.available) {
      const detector = this.registry.detector(assistant);
      if (!detector) continue;
      const results = await detector.pollActivity(sessionPaths);
      // Keep the highest-priority state per session
      for (const [id, state] of Object.entries(results)) {
        const existing = merged[id];
        if (existing !== undefined) {
          if (getActivityPriority(state) > getActivityPriority(existing)) {
            merged[id] = state;
          }
        } else {
          merged[id] = state;
        }
      }
    }

    return merged;
  }

  /** Query all registered detectors and return the highest-priority state. */
  async activityState(sessionId: string): Promise<ActivityState> {
    let best: ActivityState = 'stale';
    for (const assistant of this.registry.available) {
      const detector = this.registry.detector(assistant);
      if (!detector) continue;
      const state = await detector.activityState(sessionId);
      if (getActivityPriority(state) > getActivityPriority(best)) {
        best = state;
      }
    }
    return best;
  }

  /**
   * Resolve pending stops across all registered detectors.
   * Returns a combined list of session IDs that resolved.
   */
  async resolvePendingStops(): Promise<string[]> {
    const allResolved: string[] = [];
    for (const assistant of this.registry.available) {
      const detector = this.registry.detector(assistant);
      if (!detector) continue;
      const resolved = await detector.resolvePendingStops();
      allResolved.push(...resolved);
    }
    return allResolved;
  }
}
