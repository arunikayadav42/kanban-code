/**
 * JSON serialization with sorted keys.
 * Matches Swift's JSONEncoder with .sortedKeys + .prettyPrinted.
 *
 * Swift source: CoordinationStore.swift:15, SettingsStore.swift:180
 */

/** Recursively sort object keys during JSON.stringify. */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return value;
}

/** JSON.stringify with sorted keys and 2-space indent (matches Swift encoder). */
export function stringifySorted(value: unknown): string {
  return JSON.stringify(value, sortedReplacer, 2);
}
