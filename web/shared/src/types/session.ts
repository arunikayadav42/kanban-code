/**
 * A discovered coding assistant session, extracted from session files.
 *
 * Swift source: Sources/KanbanCodeCore/Domain/Entities/Session.swift
 */

import type { CodingAssistant } from './coding-assistant.js';

export interface Session {
  id: string;
  name?: string | null;
  firstPrompt?: string | null;
  projectPath?: string | null;
  gitBranch?: string | null;
  messageCount: number;
  modifiedTime: string; // ISO8601
  jsonlPath?: string | null;
  assistant: CodingAssistant;
}

/** Display title: custom name → first prompt (100 chars) → session ID prefix + "..." */
export function getSessionDisplayTitle(session: Session): string {
  if (session.name && session.name.length > 0) return session.name;
  if (session.firstPrompt && session.firstPrompt.length > 0) {
    return session.firstPrompt.substring(0, 100);
  }
  return session.id.substring(0, 8) + '...';
}
