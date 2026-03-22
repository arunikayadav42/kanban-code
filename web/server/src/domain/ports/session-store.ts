import type { ConversationTurn } from '@kanban-code/shared';

/** Search result from BM25 full-text search. */
export interface SearchResult {
  sessionPath: string;
  score: number;
  snippets: string[];
}

/** Port for reading and modifying session files. */
export interface SessionStore {
  readTranscript(sessionPath: string): Promise<ConversationTurn[]>;
  forkSession(sessionPath: string, targetDirectory?: string | null): Promise<string>;
  truncateSession(sessionPath: string, afterTurn: ConversationTurn): Promise<void>;
  searchSessions(query: string, paths: string[]): Promise<SearchResult[]>;
  searchSessionsStreaming(
    query: string,
    paths: string[],
    onResult: (results: SearchResult[]) => void,
  ): Promise<void>;
  writeSession(turns: ConversationTurn[], sessionId: string, projectPath?: string | null): Promise<string>;
  resolveSessionPath(sessionId: string, originalPath: string): string;
}
