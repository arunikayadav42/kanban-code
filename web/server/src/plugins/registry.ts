import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import type { AssistantDescriptor } from '@kanban-code/shared';
import { isAvailable } from '../infrastructure/shell-command.js';
import type { CodingAssistantRegistry } from '../usecases/coding-assistant-registry.js';

/**
 * Scans the plugins directory for subdirectories containing a descriptor.json,
 * checks CLI availability, dynamically imports adapter factories, and registers
 * each available assistant with the given registry.
 *
 * @param pluginsDir - Absolute path to the plugins directory
 * @param registry - The CodingAssistantRegistry to register adapters with
 * @returns Array of loaded AssistantDescriptor objects (only those that are available)
 */
export async function loadPlugins(
  pluginsDir: string,
  registry: CodingAssistantRegistry,
): Promise<AssistantDescriptor[]> {
  const descriptors: AssistantDescriptor[] = [];

  let entries;
  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true });
  } catch {
    return descriptors;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const descPath = path.join(pluginsDir, entry.name, 'descriptor.json');
    try {
      const raw = readFileSync(descPath, 'utf-8');
      const desc: AssistantDescriptor = JSON.parse(raw);

      if (!(await isAvailable(desc.availabilityCheck))) continue;

      const adapterModulePath = path.join(pluginsDir, entry.name, 'adapters', 'index.js');
      const factory = await import(adapterModulePath);
      const { discovery, detector, store } = factory.createAdapters(desc);

      registry.register(desc.id as Parameters<typeof registry.register>[0], discovery, detector, store);
      descriptors.push(desc);
    } catch {
      // Skip broken or incomplete plugins silently
    }
  }

  return descriptors;
}
