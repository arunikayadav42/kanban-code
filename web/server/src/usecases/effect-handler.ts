import type { Effect, Action } from './board-store.js';
import type { CoordinationStore } from '../infrastructure/coordination-store.js';
import type { TmuxManagerPort } from '../domain/ports/tmux-manager.js';
import { moveSession } from '../infrastructure/session-file-mover.js';
import { ImageSender } from './image-sender.js';
import { getSupportsImageUpload, getUsesPasteInput } from '@kanban-code/shared';
import { info, error as logError } from '../infrastructure/logger.js';
import fs from 'fs';

/**
 * Executes async side effects produced by the Reducer.
 * Can dispatch follow-up Actions back to the store.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/EffectHandler.swift (147 lines)
 * Spec: Section 5.1 (EffectHandler)
 */

export class EffectHandler {
  constructor(
    private readonly coordinationStore: CoordinationStore,
    private readonly tmux: TmuxManagerPort | null = null,
  ) {}

  async execute(effect: Effect, dispatch: (action: Action) => void): Promise<void> {
    try {
      switch (effect.type) {
        case 'persistLinks': {
          const links = Object.values(effect.links);
          this.coordinationStore.writeLinks(links);
          break;
        }

        case 'upsertLink': {
          this.coordinationStore.upsertLink(effect.link);
          break;
        }

        case 'removeLink': {
          this.coordinationStore.removeLinkById(effect.id);
          break;
        }

        case 'createTmuxSession': {
          if (!this.tmux) break;
          try {
            await this.tmux.createSession(effect.name, effect.path, effect.command);
            dispatch({ type: 'terminalCreated', cardId: effect.cardId, tmuxName: effect.name });
          } catch (err) {
            dispatch({ type: 'terminalFailed', cardId: effect.cardId, error: String(err) });
          }
          break;
        }

        case 'killTmuxSession': {
          if (!this.tmux) break;
          try {
            await this.tmux.killSession(effect.name);
          } catch {
            // Ignore kill failures (session may already be dead)
          }
          break;
        }

        case 'killTmuxSessions': {
          if (!this.tmux) break;
          for (const name of effect.names) {
            try {
              await this.tmux.killSession(name);
            } catch {
              // Ignore individual kill failures
            }
          }
          break;
        }

        case 'deleteSessionFile': {
          try {
            fs.unlinkSync(effect.path);
          } catch {
            logError('effect-handler', `Failed to delete session file: ${effect.path}`);
          }
          break;
        }

        case 'cleanupTerminalCache': {
          // In web version, terminal cleanup is handled by WebSocket disconnect
          // No action needed — PTY processes die when WS closes
          info('effect-handler', `Terminal cache cleanup: ${effect.sessionNames.join(', ')}`);
          break;
        }

        case 'updateSessionIndex': {
          try {
            const { SessionIndexReader } = await import('../adapters/claude/session-index-reader.js');
            SessionIndexReader.updateSummary(effect.sessionId, effect.name);
          } catch {
            // Index file may not exist — non-critical
          }
          break;
        }

        case 'deleteFiles': {
          for (const filePath of effect.paths) {
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
          }
          break;
        }

        case 'persistDeletedIds': {
          this.coordinationStore.writeDeletedIds({
            sessionIds: effect.sessionIds,
            cardIds: effect.cardIds,
          });
          break;
        }

        case 'moveSessionFile': {
          try {
            const newPath = moveSession(effect.sessionId, effect.oldPath, effect.newProjectPath);
            info('effect-handler', `Moved session ${effect.sessionId} → ${newPath}`);
            // Update coordination store with new path
            this.coordinationStore.updateLinkBySessionId(effect.sessionId, (link) => ({
              ...link,
              sessionLink: link.sessionLink ? { ...link.sessionLink, sessionPath: newPath } : null,
            }));
          } catch (err) {
            logError('effect-handler', `moveSessionFile failed: ${err}`);
          }
          break;
        }

        case 'sendPromptToTmux': {
          if (!this.tmux) break;
          try {
            if (getUsesPasteInput(effect.assistant)) {
              await this.tmux.pastePrompt(effect.sessionName, effect.promptBody);
            } else {
              await this.tmux.sendPrompt(effect.sessionName, effect.promptBody);
            }
            info('effect-handler', `Sent prompt to ${effect.sessionName}`);
          } catch (err) {
            logError('effect-handler', `sendPromptToTmux failed: ${err}`);
          }
          break;
        }

        case 'sendPromptWithImagesToTmux': {
          if (!this.tmux) break;
          try {
            const sender = new ImageSender(this.tmux);
            // Only send images for assistants that support it
            if (getSupportsImageUpload(effect.assistant)) {
              await sender.waitForReady({ sessionName: effect.sessionName, assistant: effect.assistant });
              const images = effect.imagePaths.map((p, i) => ({
                id: `img-${i}`,
                data: fs.readFileSync(p).toString('base64'),
                tempPath: p,
              }));
              await sender.sendImages({
                sessionName: effect.sessionName,
                images,
                assistant: effect.assistant,
                setClipboard: () => {},
              });
            }
            // Send text prompt after images
            if (getUsesPasteInput(effect.assistant)) {
              await this.tmux.pastePrompt(effect.sessionName, effect.promptBody);
            } else {
              await this.tmux.sendPrompt(effect.sessionName, effect.promptBody);
            }
            info('effect-handler', `Sent prompt + ${effect.imagePaths.length} images to ${effect.sessionName}`);
          } catch (err) {
            logError('effect-handler', `sendPromptWithImagesToTmux failed: ${err}`);
          }
          break;
        }
      }
    } catch (err) {
      logError('effect-handler', `Effect execution failed: ${effect.type} — ${err}`);
    }
  }
}
