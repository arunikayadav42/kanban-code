import type { ConversationTurn } from '@kanban-code/shared';

/**
 * Extracts the last assistant response from a transcript for notification content.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Notifications/TranscriptNotificationReader.swift
 * Spec: Section 7.6 (Notification content extraction)
 *
 * Two main functions:
 * - lastAssistantText: finds the last assistant turn and joins its text blocks
 * - textPreview: creates a short preview for notification body
 *   - If first line >= 42 chars, use it
 *   - Otherwise accumulate sentences (split by ".") until > 140 chars
 */

/**
 * Get the last assistant text from pre-parsed conversation turns.
 * Works with turns from any session store (Claude, Gemini, etc.).
 * Returns null if no assistant turns with text content exist.
 */
export function lastAssistantText(turns: ConversationTurn[]): string | null {
  // Find the last assistant turn with text content
  const assistantTurns = turns.filter((t) => t.role === 'assistant');
  const lastTurn = assistantTurns[assistantTurns.length - 1];
  if (!lastTurn) return null;

  // Join text-only content blocks
  const textBlocks = lastTurn.contentBlocks
    .filter((block) => block.kind.type === 'text')
    .map((block) => block.text);

  const text = textBlocks.join('\n').trim();
  return text.length === 0 ? null : text;
}

/**
 * Get a short text preview for notification body.
 * Mirrors claude-pushover's get_text_preview() exactly:
 * - If first line is >= 42 chars, use it
 * - Otherwise accumulate sentences (split by ".") until > 140 chars
 */
export function textPreview(text: string): string {
  const firstLine = text.split('\n')[0] ?? text;
  if (firstLine.length >= 42) {
    return firstLine;
  }

  // Accumulate sentences until > 140 chars
  const sentences = text.split('.');
  let accumulated = '';
  for (const sentence of sentences) {
    if (sentence.length === 0) continue;
    if (accumulated.length === 0) {
      accumulated = sentence + '.';
    } else {
      accumulated += sentence + '.';
    }
    if (accumulated.length > 140) {
      break;
    }
  }

  return accumulated.length === 0 ? firstLine : accumulated;
}
