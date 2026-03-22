import type { Session } from '@kanban-code/shared';
import { getDisplayName } from '@kanban-code/shared';
import type { SessionDiscovery } from '../domain/ports/session-discovery.js';
import type { CodingAssistantRegistry } from './coding-assistant-registry.js';

/**
 * A SessionDiscovery implementation that wraps the registry, calls all
 * registered assistant discoveries, and merges results sorted by modification
 * time descending. If one assistant's discovery fails, it logs the error and
 * continues with the others.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/CompositeSessionDiscovery.swift
 */
export class CompositeSessionDiscovery implements SessionDiscovery {
  constructor(private readonly registry: CodingAssistantRegistry) {}

  async discoverSessions(): Promise<Session[]> {
    const allSessions: Session[] = [];

    for (const assistant of this.registry.available) {
      const discovery = this.registry.discovery(assistant);
      if (!discovery) continue;
      try {
        const sessions = await discovery.discoverSessions();
        allSessions.push(...sessions);
      } catch (error) {
        console.warn(
          `[composite-discovery] discoverSessions failed for ${getDisplayName(assistant)}: ${error}`,
        );
      }
    }

    return allSessions.sort(
      (a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime(),
    );
  }

  async discoverNewOrModified(since: Date): Promise<Session[]> {
    const allSessions: Session[] = [];

    for (const assistant of this.registry.available) {
      const discovery = this.registry.discovery(assistant);
      if (!discovery) continue;
      try {
        const sessions = await discovery.discoverNewOrModified(since);
        allSessions.push(...sessions);
      } catch (error) {
        console.warn(
          `[composite-discovery] discoverNewOrModified failed for ${getDisplayName(assistant)}: ${error}`,
        );
      }
    }

    return allSessions.sort(
      (a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime(),
    );
  }
}
