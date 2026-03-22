import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Moves a Claude Code session .jsonl file from one project folder to another,
 * updating the `cwd` field in all JSONL lines.
 *
 * Swift source: Sources/KanbanCodeCore/Infrastructure/SessionFileMover.swift
 * Spec: Section 7 (Infrastructure), Section 7.13 (Directory Encoding)
 */

/**
 * Move a session file to a new project folder. Returns the new file path.
 */
export function moveSession(
  sessionId: string,
  fromPath: string,
  toProjectPath: string,
): string {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  const targetDirName = encodeProjectPath(toProjectPath);
  const targetDir = path.join(projectsDir, targetDirName);
  const targetPath = path.join(targetDir, `${sessionId}.jsonl`);

  // Create target directory if needed
  fs.mkdirSync(targetDir, { recursive: true });

  // Read original file
  const content = fs.readFileSync(fromPath, 'utf-8');
  const lines = content.split('\n');

  // Update cwd in all lines
  const newLines: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      newLines.push(line);
      continue;
    }
    try {
      const obj = JSON.parse(line);
      if (obj.cwd !== undefined) {
        obj.cwd = toProjectPath;
      }
      newLines.push(JSON.stringify(obj));
    } catch {
      newLines.push(line); // keep unparseable lines as-is
    }
  }

  // Write to new location
  fs.writeFileSync(targetPath, newLines.join('\n'), 'utf-8');

  // Remove original (only if different path)
  if (fromPath !== targetPath) {
    try { fs.unlinkSync(fromPath); } catch { /* ignore */ }
  }

  // Best-effort: remove from source sessions-index.json
  const sourceDir = path.dirname(fromPath);
  const sourceIndexPath = path.join(sourceDir, 'sessions-index.json');
  try {
    if (fs.existsSync(sourceIndexPath)) {
      const indexData = JSON.parse(fs.readFileSync(sourceIndexPath, 'utf-8'));
      if (Array.isArray(indexData.entries)) {
        indexData.entries = indexData.entries.filter(
          (e: Record<string, unknown>) => e.sessionId !== sessionId,
        );
        fs.writeFileSync(sourceIndexPath, JSON.stringify(indexData, null, 2), 'utf-8');
      }
    }
  } catch { /* best-effort */ }

  return targetPath;
}

/**
 * Encode a project path for use as a directory name.
 * Matches Claude CLI's encoding: replaces / with - first, then strips dots.
 *
 * Example: "/Users/me/Projects/repo" → "-Users-me-Projects-repo"
 */
export function encodeProjectPath(projectPath: string): string {
  return projectPath
    .replace(/\//g, '-')
    .replace(/\./g, '');
}
