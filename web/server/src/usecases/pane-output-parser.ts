/**
 * Parses tmux capture-pane output to detect coding assistant state.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/PaneOutputParser.swift
 */

import type { CodingAssistant } from '@kanban-code/shared';
import { getPromptCharacter, ALL_ASSISTANTS } from '@kanban-code/shared';

/**
 * Count image attachments visible in Claude Code's TUI.
 * Counts actual [Image #N] occurrences, not lines -- multiple images can appear on one line.
 */
export function countImages(paneOutput: string): number {
  let count = 0;
  const needle = '[Image #';
  let idx = 0;
  while (idx < paneOutput.length) {
    const found = paneOutput.indexOf(needle, idx);
    if (found === -1) break;
    count++;
    idx = found + needle.length;
  }
  return count;
}

/** Check if the assistant's input prompt is visible (ready for input). */
export function isReady(paneOutput: string, assistant: CodingAssistant): boolean {
  return paneOutput.includes(getPromptCharacter(assistant));
}

/** @deprecated Use isReady(paneOutput, assistant) instead. */
export function isClaudeReady(paneOutput: string): boolean {
  return isReady(paneOutput, ALL_ASSISTANTS[0]);
}
