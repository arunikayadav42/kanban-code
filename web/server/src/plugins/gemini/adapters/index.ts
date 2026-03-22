import { GeminiSessionDiscovery } from '../../../adapters/gemini/session-discovery.js';
import { GeminiActivityDetector } from '../../../adapters/gemini/activity-detector.js';
import { GeminiSessionStore } from '../../../adapters/gemini/session-store.js';
import type { AssistantDescriptor } from '@kanban-code/shared';

export function createAdapters(_desc: AssistantDescriptor) {
  return {
    discovery: new GeminiSessionDiscovery(),
    detector: new GeminiActivityDetector(),
    store: new GeminiSessionStore(),
  };
}
