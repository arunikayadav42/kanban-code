import { KiroSessionDiscovery } from '../../../adapters/kiro/session-discovery.js';
import { KiroActivityDetector } from '../../../adapters/kiro/activity-detector.js';
import { KiroSessionStore } from '../../../adapters/kiro/session-store.js';
import type { AssistantDescriptor } from '@kanban-code/shared';

export function createAdapters(_desc: AssistantDescriptor) {
  return {
    discovery: new KiroSessionDiscovery(),
    detector: new KiroActivityDetector(),
    store: new KiroSessionStore(),
  };
}
