import type { CodingAssistant } from '@kanban-code/shared';
import type { SessionDiscovery } from '../domain/ports/session-discovery.js';
import type { ActivityDetector } from '../domain/ports/activity-detector.js';
import type { SessionStore } from '../domain/ports/session-store.js';

/**
 * Registry that maps CodingAssistant values to their adapter instances
 * (discovery, activity detector, session store). Used by composite adapters
 * to route operations to the correct assistant-specific implementation.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/CodingAssistantRegistry.swift
 */
export class CodingAssistantRegistry {
  private discoveries = new Map<CodingAssistant, SessionDiscovery>();
  private detectors = new Map<CodingAssistant, ActivityDetector>();
  private stores = new Map<CodingAssistant, SessionStore>();

  /** Register all three adapters for a coding assistant. */
  register(
    assistant: CodingAssistant,
    discovery: SessionDiscovery,
    detector: ActivityDetector,
    store: SessionStore,
  ): void {
    this.discoveries.set(assistant, discovery);
    this.detectors.set(assistant, detector);
    this.stores.set(assistant, store);
  }

  /** Returns the session discovery adapter for the given assistant, if registered. */
  discovery(assistant: CodingAssistant): SessionDiscovery | undefined {
    return this.discoveries.get(assistant);
  }

  /** Returns the activity detector for the given assistant, if registered. */
  detector(assistant: CodingAssistant): ActivityDetector | undefined {
    return this.detectors.get(assistant);
  }

  /** Returns the session store for the given assistant, if registered. */
  store(assistant: CodingAssistant): SessionStore | undefined {
    return this.stores.get(assistant);
  }

  /** Remove all adapters for a coding assistant. */
  unregister(assistant: CodingAssistant): void {
    this.discoveries.delete(assistant);
    this.detectors.delete(assistant);
    this.stores.delete(assistant);
  }

  /** All registered assistants, sorted alphabetically for deterministic ordering. */
  get available(): CodingAssistant[] {
    return Array.from(this.discoveries.keys()).sort();
  }
}
