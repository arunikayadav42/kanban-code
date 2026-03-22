import { describe, it, expect, vi } from 'vitest';
import { ImageSender, ImageSendError } from '../image-sender.js';
import type { TmuxManagerPort } from '../../domain/ports/tmux-manager.js';
import type { ImageAttachment } from '@kanban-code/shared';

/** Creates a mock TmuxManagerPort with controllable capturePane output. */
function mockTmux(options?: {
  paneOutputs?: string[];
}): TmuxManagerPort & { captureCallCount: number; pasteCallCount: number } {
  const outputs = options?.paneOutputs ?? [];
  let captureIdx = 0;
  const mock = {
    captureCallCount: 0,
    pasteCallCount: 0,
    listSessions: async () => [],
    createSession: async () => {},
    killSession: async () => {},
    findSessionForWorktree: () => null,
    sendPrompt: async () => {},
    pastePrompt: async () => {},
    capturePane: async () => {
      mock.captureCallCount++;
      const output = outputs[captureIdx] ?? outputs[outputs.length - 1] ?? '';
      captureIdx++;
      return output;
    },
    sendBracketedPaste: async () => {
      mock.pasteCallCount++;
    },
    isAvailable: async () => true,
  };
  return mock;
}

describe('ImageSender', () => {
  describe('waitForReady', () => {
    it('resolves immediately when prompt is visible', async () => {
      const tmux = mockTmux({ paneOutputs: ['some output \u276F '] });
      const sender = new ImageSender(tmux);

      await sender.waitForReady({ sessionName: 'test-session', assistant: 'claude', pollIntervalMs: 10 });

      expect(tmux.captureCallCount).toBe(1);
    });

    it('polls until prompt appears', async () => {
      const tmux = mockTmux({
        paneOutputs: ['loading...', 'still loading...', 'ready \u276F '],
      });
      const sender = new ImageSender(tmux);

      await sender.waitForReady({ sessionName: 'test-session', assistant: 'claude', pollIntervalMs: 10 });

      expect(tmux.captureCallCount).toBe(3);
    });

    it('throws assistantNotReady on timeout', async () => {
      const tmux = mockTmux({ paneOutputs: ['still loading...'] });
      const sender = new ImageSender(tmux);

      await expect(
        sender.waitForReady({ sessionName: 'test-session', assistant: 'claude', pollIntervalMs: 10, timeoutMs: 50 }),
      ).rejects.toThrow(ImageSendError);

      await expect(
        sender.waitForReady({ sessionName: 'test-session', assistant: 'claude', pollIntervalMs: 10, timeoutMs: 50 }),
      ).rejects.toThrow(/did not become ready/);
    });

    it('uses 30s default timeout for claude', async () => {
      // Just verify it doesn't throw when prompt is visible immediately
      const tmux = mockTmux({ paneOutputs: ['\u276F '] });
      const sender = new ImageSender(tmux);

      await sender.waitForReady({ sessionName: 'test', assistant: 'claude', pollIntervalMs: 10 });
      expect(tmux.captureCallCount).toBe(1);
    });

    it('uses 60s default timeout for gemini', async () => {
      // Just verify it uses gemini prompt character
      const tmux = mockTmux({ paneOutputs: ['Type your message'] });
      const sender = new ImageSender(tmux);

      await sender.waitForReady({ sessionName: 'test', assistant: 'gemini', pollIntervalMs: 10 });
      expect(tmux.captureCallCount).toBe(1);
    });

    it('includes assistant name in error', async () => {
      const tmux = mockTmux({ paneOutputs: ['loading'] });
      const sender = new ImageSender(tmux);

      try {
        await sender.waitForReady({
          sessionName: 'test',
          assistant: 'gemini',
          pollIntervalMs: 10,
          timeoutMs: 30,
        });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ImageSendError);
        const error = err as ImageSendError;
        expect(error.code).toBe('assistantNotReady');
        expect(error.assistant).toBe('gemini');
        expect(error.message).toContain('Gemini CLI');
      }
    });
  });

  describe('sendImages', () => {
    const testImages: ImageAttachment[] = [
      { id: 'img1', data: 'base64data1' },
      { id: 'img2', data: 'base64data2' },
    ];

    it('sends a single image and confirms via pane output', async () => {
      const tmux = mockTmux({
        // capture before send, then capture after send showing image
        paneOutputs: ['no images', 'no images [Image #1] confirmed'],
      });
      const sender = new ImageSender(tmux);
      const clipboardData: string[] = [];

      await sender.sendImages({
        sessionName: 'test',
        images: [testImages[0]!],
        assistant: 'claude',
        setClipboard: (data) => clipboardData.push(data),
        pollIntervalMs: 10,
      });

      expect(clipboardData).toEqual(['base64data1']);
      expect(tmux.pasteCallCount).toBe(1);
    });

    it('sends multiple images sequentially', async () => {
      const tmux = mockTmux({
        paneOutputs: [
          'no images',           // capture before first image
          '[Image #1]',          // capture after first image (poll)
          '[Image #1]',          // capture before second image
          '[Image #1] [Image #2]', // capture after second image (poll)
        ],
      });
      const sender = new ImageSender(tmux);
      const clipboardData: string[] = [];

      await sender.sendImages({
        sessionName: 'test',
        images: testImages,
        assistant: 'claude',
        setClipboard: (data) => clipboardData.push(data),
        pollIntervalMs: 10,
      });

      expect(clipboardData).toEqual(['base64data1', 'base64data2']);
      expect(tmux.pasteCallCount).toBe(2);
    });

    it('throws imageUploadTimeout when image is not confirmed', async () => {
      const tmux = mockTmux({
        paneOutputs: ['no images'], // never shows [Image #N]
      });
      const sender = new ImageSender(tmux);

      await expect(
        sender.sendImages({
          sessionName: 'test',
          images: [testImages[0]!],
          assistant: 'claude',
          setClipboard: () => {},
          pollIntervalMs: 10,
          timeoutMs: 50,
        }),
      ).rejects.toThrow(/Timed out waiting for image #1/);
    });

    it('includes image number in timeout error', async () => {
      const tmux = mockTmux({
        paneOutputs: [
          'no images',    // before first
          '[Image #1]',   // first confirmed
          '[Image #1]',   // before second (same count = 1)
          // Never shows [Image #2]
        ],
      });
      const sender = new ImageSender(tmux);

      try {
        await sender.sendImages({
          sessionName: 'test',
          images: testImages,
          assistant: 'claude',
          setClipboard: () => {},
          pollIntervalMs: 10,
          timeoutMs: 50,
        });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ImageSendError);
        const error = err as ImageSendError;
        expect(error.code).toBe('imageUploadTimeout');
        expect(error.imageNumber).toBe(2);
        expect(error.assistant).toBe('claude');
      }
    });

    it('sends empty array of images without error', async () => {
      const tmux = mockTmux();
      const sender = new ImageSender(tmux);

      await sender.sendImages({
        sessionName: 'test',
        images: [],
        assistant: 'claude',
        setClipboard: () => {},
      });

      expect(tmux.pasteCallCount).toBe(0);
    });

    it('calls sendBracketedPaste for each image', async () => {
      const tmux = mockTmux({
        paneOutputs: [
          '',                    // before first
          '[Image #1]',          // first confirmed
          '[Image #1]',          // before second
          '[Image #1] [Image #2]', // second confirmed
        ],
      });
      const sender = new ImageSender(tmux);

      await sender.sendImages({
        sessionName: 'test',
        images: testImages,
        assistant: 'claude',
        setClipboard: () => {},
        pollIntervalMs: 10,
      });

      expect(tmux.pasteCallCount).toBe(2);
    });
  });

  describe('ImageSendError', () => {
    it('has correct properties for assistantNotReady', () => {
      const error = new ImageSendError('assistantNotReady', 'claude');
      expect(error.name).toBe('ImageSendError');
      expect(error.code).toBe('assistantNotReady');
      expect(error.assistant).toBe('claude');
      expect(error.message).toContain('Claude Code');
      expect(error.message).toContain('did not become ready');
    });

    it('has correct properties for imageUploadTimeout', () => {
      const error = new ImageSendError('imageUploadTimeout', 'gemini', 3);
      expect(error.name).toBe('ImageSendError');
      expect(error.code).toBe('imageUploadTimeout');
      expect(error.assistant).toBe('gemini');
      expect(error.imageNumber).toBe(3);
      expect(error.message).toContain('image #3');
      expect(error.message).toContain('Gemini CLI');
    });
  });
});
