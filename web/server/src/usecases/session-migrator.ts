/**
 * Migrates a session from one coding assistant to another.
 * Reads the source transcript, writes to the target format, and creates a backup.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/SessionMigrator.swift (69 lines)
 */

import fs from 'fs';
import { randomUUID } from 'crypto';
import type { SessionStore } from '../domain/ports/session-store.js';

/** Result of a successful session migration. */
export interface MigrationResult {
  newSessionId: string;
  newSessionPath: string;
  backupPath: string;
}

/** Errors from session migration operations. */
export class MigrationError extends Error {
  constructor(public readonly code: 'emptySession') {
    super(
      code === 'emptySession'
        ? 'Session has no conversation turns to migrate'
        : 'Unknown migration error',
    );
    this.name = 'MigrationError';
  }
}

/**
 * Migrate a session from one assistant to another.
 *
 * @param sourceSessionPath - Path to the source session file
 * @param sourceStore - The session store for the source assistant
 * @param targetStore - The session store for the target assistant
 * @param projectPath - The project path for file placement
 * @returns Migration result with new session info and backup path
 */
export async function migrate(
  sourceSessionPath: string,
  sourceStore: SessionStore,
  targetStore: SessionStore,
  projectPath: string | null,
): Promise<MigrationResult> {
  // 1. Read transcript from source
  const turns = await sourceStore.readTranscript(sourceSessionPath);
  if (turns.length === 0) {
    throw new MigrationError('emptySession');
  }

  // 2. Generate new session ID
  const newSessionId = randomUUID();

  // 3. Write to target format
  const newSessionPath = await targetStore.writeSession(
    turns,
    newSessionId,
    projectPath,
  );

  // 4. Backup source file, then remove original so the reconciler
  //    doesn't rediscover it and create a duplicate card.
  const backupPath = sourceSessionPath + '.bak';
  try {
    fs.unlinkSync(backupPath);
  } catch {
    // May not exist -- fine
  }
  fs.copyFileSync(sourceSessionPath, backupPath);
  try {
    fs.unlinkSync(sourceSessionPath);
  } catch {
    // Best effort removal
  }

  return {
    newSessionId,
    newSessionPath,
    backupPath,
  };
}
