import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Request, Response, NextFunction } from 'express';
import { info, warn } from '../infrastructure/logger.js';

/**
 * Authentication middleware — token-based auth for remote access.
 *
 * Spec: Section 2.5 (Security & Authentication)
 *
 * Local mode (default): no auth required when bind address is localhost
 * Remote mode (KANBAN_AUTH=required): token-based auth mandatory
 */

const kanbanBase = process.env.KANBAN_BASE ?? path.join(os.homedir(), '.kanban-code-web');
const TOKEN_FILE = path.join(kanbanBase, 'auth-token');

let cachedToken: string | null = null;

/** Generate or read the auth token. */
export function getOrCreateToken(): string {
  if (cachedToken) return cachedToken;

  try {
    if (fs.existsSync(TOKEN_FILE)) {
      cachedToken = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
      if (cachedToken.length > 0) return cachedToken;
    }
  } catch { /* ignore */ }

  // Generate new 256-bit token
  cachedToken = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, cachedToken, { mode: 0o600 });
  } catch {
    warn('auth', 'Failed to persist auth token');
  }

  return cachedToken;
}

/** Rotate the auth token — invalidates all existing sessions. */
export function rotateToken(): string {
  cachedToken = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(TOKEN_FILE, cachedToken, { mode: 0o600 });
  } catch { /* ignore */ }
  info('auth', 'Auth token rotated');
  return cachedToken;
}

/** Check if auth is required based on environment config. */
export function isAuthRequired(): boolean {
  return process.env.KANBAN_AUTH === 'required';
}

/**
 * Express middleware for token authentication.
 * Checks Authorization: Bearer <token> header.
 * Also accepts ?token=<token> query parameter.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthRequired()) {
    next();
    return;
  }

  const token = getOrCreateToken();

  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const provided = authHeader.slice(7);
    if (provided === token) {
      next();
      return;
    }
  }

  // Check query parameter (for SSE and initial page load)
  const queryToken = req.query.token as string | undefined;
  if (queryToken === token) {
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized', message: 'Valid auth token required' });
}

/** Validate a WebSocket upgrade request token. */
export function validateWsToken(url: string, headers: Record<string, string>): boolean {
  if (!isAuthRequired()) return true;

  const token = getOrCreateToken();

  // Check Authorization header
  const auth = headers.authorization;
  if (auth?.startsWith('Bearer ') && auth.slice(7) === token) return true;

  // Check URL query parameter
  try {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.searchParams.get('token') === token) return true;
  } catch { /* ignore */ }

  return false;
}
