import { ClaudeCodeSessionDiscovery } from '../../../adapters/claude/session-discovery.js';
import { ClaudeCodeActivityDetector } from '../../../adapters/claude/activity-detector.js';
import { ClaudeCodeSessionStore } from '../../../adapters/claude/session-store.js';
import type { AssistantDescriptor } from '@kanban-code/shared';

export function createAdapters(_desc: AssistantDescriptor) {
  return {
    discovery: new ClaudeCodeSessionDiscovery(),
    detector: new ClaudeCodeActivityDetector(),
    store: new ClaudeCodeSessionStore(),
  };
}
