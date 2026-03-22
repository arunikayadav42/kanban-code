/**
 * A transient image attachment for prompt dialogs.
 *
 * Swift source: Sources/KanbanCodeCore/Domain/Entities/ImageAttachment.swift
 * Note: In web version, image data is a Uint8Array or base64 string.
 * File save operations happen on the server side.
 */

export interface ImageAttachment {
  id: string;
  data: string; // base64-encoded PNG data (web equivalent of Swift Data)
  tempPath?: string | null;
}

/** Temp file path pattern (matches Swift). */
export function getTempPath(id: string): string {
  return `/tmp/kanban-code-img-${id}.png`;
}

/** Persistent file path pattern (matches Swift). Server-side only. */
export function getPersistentPath(id: string, homeDir?: string): string {
  const home = homeDir ?? '~';
  return `${home}/.kanban-code/images/${id}.png`;
}
