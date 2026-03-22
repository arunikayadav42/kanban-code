/**
 * Orchestrates sending images to a Claude Code session via tmux.
 *
 * For each image:
 * 1. Sets the system clipboard to the image data (via injected closure)
 * 2. Sends an empty bracketed paste event to the tmux session
 * 3. Polls `tmux capture-pane` until Claude confirms the image with `[Image #N]`
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/ImageSender.swift (88 lines)
 */

import type { CodingAssistant, ImageAttachment } from '@kanban-code/shared';
import { getDisplayName, getReadyTimeoutMs } from '@kanban-code/shared';
import type { TmuxManagerPort } from '../domain/ports/tmux-manager.js';
import * as PaneOutputParser from './pane-output-parser.js';

/** Errors from image sending operations. */
export class ImageSendError extends Error {
  constructor(
    public readonly code: 'assistantNotReady' | 'imageUploadTimeout',
    public readonly assistant: CodingAssistant,
    public readonly imageNumber?: number,
  ) {
    const name = getDisplayName(assistant);
    const msg =
      code === 'assistantNotReady'
        ? `${name} did not become ready within the timeout period`
        : `Timed out waiting for image #${imageNumber} to be accepted by ${name}`;
    super(msg);
    this.name = 'ImageSendError';
  }
}

export class ImageSender {
  private readonly tmux: TmuxManagerPort;

  constructor(tmux: TmuxManagerPort) {
    this.tmux = tmux;
  }

  /**
   * Wait for the coding assistant to show its input prompt.
   */
  async waitForReady(options: {
    sessionName: string;
    assistant: CodingAssistant;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<void> {
    const assistant = options.assistant;
    const pollIntervalMs = options.pollIntervalMs ?? 500;
    const timeoutMs = options.timeoutMs ?? getReadyTimeoutMs(assistant);

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const output = await this.tmux.capturePane(options.sessionName);
      if (PaneOutputParser.isReady(output, assistant)) return;
      await sleep(pollIntervalMs);
    }
    throw new ImageSendError('assistantNotReady', assistant);
  }

  /**
   * Send images one by one, confirming each before sending the next.
   *
   * @param options.sessionName - tmux session target
   * @param options.images - images to send
   * @param options.setClipboard - closure that sets the system clipboard to image data (injected for testability)
   * @param options.pollIntervalMs - how often to check for confirmation (default 500ms)
   * @param options.timeoutMs - max time to wait per image (default 30s)
   */
  async sendImages(options: {
    sessionName: string;
    images: ImageAttachment[];
    assistant: CodingAssistant;
    setClipboard: (data: string) => void;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<void> {
    const assistant = options.assistant;
    const pollIntervalMs = options.pollIntervalMs ?? 500;
    const timeoutMs = options.timeoutMs ?? 30_000;

    for (let index = 0; index < options.images.length; index++) {
      const image = options.images[index]!;

      // Count before sending
      const before = await this.tmux.capturePane(options.sessionName);
      const countBefore = PaneOutputParser.countImages(before);

      options.setClipboard(image.data);
      await this.tmux.sendBracketedPaste(options.sessionName);

      // Poll until count goes up
      const start = Date.now();
      let confirmed = false;
      while (Date.now() - start < timeoutMs) {
        await sleep(pollIntervalMs);
        const output = await this.tmux.capturePane(options.sessionName);
        if (PaneOutputParser.countImages(output) > countBefore) {
          confirmed = true;
          break;
        }
      }
      if (!confirmed) {
        throw new ImageSendError('imageUploadTimeout', assistant, index + 1);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
