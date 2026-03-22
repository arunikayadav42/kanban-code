import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Link } from '@kanban-code/shared';
import { parseLinkFromJSON } from '@kanban-code/shared';
import { stringifySorted } from './json-utils.js';

/**
 * Persistent store for Link records in ~/.kanban-code/links.json.
 * Atomic writes, corruption recovery.
 *
 * Swift source: Sources/KanbanCodeCore/Infrastructure/CoordinationStore.swift
 * Spec: Section 7 (Infrastructure)
 *
 * Note: Swift uses actor isolation. Node.js is single-threaded, so
 * we don't need explicit locking. Operations are naturally serialized.
 */

interface LinksContainer {
  links: Link[];
}

interface DeletedIds {
  sessionIds: string[];
  cardIds: string[];
}

export class CoordinationStore {
  private readonly filePath: string;
  private readonly deletedIdsPath: string;

  constructor(basePath?: string) {
    const base = basePath ?? path.join(os.homedir(), '.kanban-code');
    this.filePath = path.join(base, 'links.json');
    this.deletedIdsPath = path.join(base, 'deleted-ids.json');
  }

  /** Read all links from the coordination file. */
  readLinks(): Link[] {
    return this.readContainer().links;
  }

  private readContainer(): LinksContainer {
    if (!fs.existsSync(this.filePath)) {
      return { links: [] };
    }

    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      const raw = JSON.parse(data);

      // Parse each link with backward-compat handling
      const links: Link[] = (raw.links ?? []).map((linkJson: Record<string, unknown>) =>
        parseLinkFromJSON(linkJson)
      );

      return { links };
    } catch {
      // Corruption recovery: backup and return empty
      const backupPath = this.filePath + '.bkp';
      try {
        fs.copyFileSync(this.filePath, backupPath);
      } catch { /* ignore backup failure */ }
      return { links: [] };
    }
  }

  /** Write all links to the coordination file (atomic: write .tmp → rename). */
  writeLinks(links: Link[]): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const container: LinksContainer = { links };
    const data = stringifySorted(container);

    // Atomic write: write to .tmp, then rename
    const tmpPath = this.filePath + '.tmp';
    fs.writeFileSync(tmpPath, data, 'utf-8');
    try { fs.unlinkSync(this.filePath); } catch { /* may not exist */ }
    fs.renameSync(tmpPath, this.filePath);
  }

  /** Get a single link by its id. */
  linkById(id: string): Link | null {
    return this.readLinks().find(l => l.id === id) ?? null;
  }

  /** Get a single link by session ID. */
  linkForSession(sessionId: string): Link | null {
    return this.readLinks().find(l => l.sessionLink?.sessionId === sessionId) ?? null;
  }

  /** Upsert a link: update if exists (by link.id), insert if new. */
  upsertLink(link: Link): void {
    const links = this.readLinks();
    const index = links.findIndex(l => l.id === link.id);
    if (index >= 0) {
      links[index] = link;
    } else {
      links.push(link);
    }
    this.writeLinks(links);
  }

  /** Update specific fields of a link by link.id. */
  updateLinkById(id: string, update: (link: Link) => Link): void {
    const links = this.readLinks();
    const index = links.findIndex(l => l.id === id);
    if (index < 0) return;
    links[index] = { ...update(links[index]), updatedAt: new Date().toISOString() };
    this.writeLinks(links);
  }

  /** Update specific fields of a link by session ID. */
  updateLinkBySessionId(sessionId: string, update: (link: Link) => Link): void {
    const links = this.readLinks();
    const index = links.findIndex(l => l.sessionLink?.sessionId === sessionId);
    if (index < 0) return;
    links[index] = { ...update(links[index]), updatedAt: new Date().toISOString() };
    this.writeLinks(links);
  }

  /** Remove a link by its id. */
  removeLinkById(id: string): void {
    const links = this.readLinks().filter(l => l.id !== id);
    this.writeLinks(links);
  }

  /** Remove a link by session ID. */
  removeLinkBySessionId(sessionId: string): void {
    const links = this.readLinks().filter(l => l.sessionLink?.sessionId !== sessionId);
    this.writeLinks(links);
  }

  /** Remove orphaned links whose .jsonl files no longer exist. */
  removeOrphans(): void {
    const links = this.readLinks();
    const before = links.length;
    const filtered = links.filter(link => {
      const sessionPath = link.sessionLink?.sessionPath;
      if (!sessionPath) return true; // keep links without session path
      return fs.existsSync(sessionPath);
    });
    if (filtered.length !== before) {
      this.writeLinks(filtered);
    }
  }

  /** Atomic read-modify-write. */
  modifyLinks(transform: (links: Link[]) => Link[]): void {
    const links = this.readLinks();
    const modified = transform(links);
    this.writeLinks(modified);
  }

  /** Read the persisted set of deleted session/card IDs (survives restart). */
  readDeletedIds(): DeletedIds {
    if (!fs.existsSync(this.deletedIdsPath)) {
      return { sessionIds: [], cardIds: [] };
    }
    try {
      const data = fs.readFileSync(this.deletedIdsPath, 'utf-8');
      const raw = JSON.parse(data);
      return {
        sessionIds: Array.isArray(raw.sessionIds) ? raw.sessionIds : [],
        cardIds: Array.isArray(raw.cardIds) ? raw.cardIds : [],
      };
    } catch {
      return { sessionIds: [], cardIds: [] };
    }
  }

  /** Persist the deleted session/card IDs to disk (atomic write). */
  writeDeletedIds(ids: DeletedIds): void {
    const dir = path.dirname(this.deletedIdsPath);
    fs.mkdirSync(dir, { recursive: true });
    const data = JSON.stringify(ids, null, 2);
    const tmpPath = this.deletedIdsPath + '.tmp';
    fs.writeFileSync(tmpPath, data, 'utf-8');
    try { fs.unlinkSync(this.deletedIdsPath); } catch { /* may not exist */ }
    fs.renameSync(tmpPath, this.deletedIdsPath);
  }

  /** The file path for external access / debugging. */
  get path(): string {
    return this.filePath;
  }
}
