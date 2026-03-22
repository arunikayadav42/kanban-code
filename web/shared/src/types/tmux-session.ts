/**
 * A tmux session discovered via `tmux list-sessions`.
 *
 * Swift source: Sources/KanbanCodeCore/Domain/Entities/TmuxSession.swift
 */

export interface TmuxSession {
  name: string;
  path: string; // session_path
  attached: boolean;
}
