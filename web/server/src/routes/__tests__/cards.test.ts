import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { StoreManager } from '../../usecases/store-manager.js';
import { EffectHandler } from '../../usecases/effect-handler.js';
import { CoordinationStore } from '../../infrastructure/coordination-store.js';
import { createCardRoutes } from '../cards.js';
import express from 'express';
import request from 'supertest';

describe('Card Routes', () => {
  let app: express.Express;
  let store: StoreManager;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-routes-'));
    const coordStore = new CoordinationStore(tempDir);
    const effectHandler = new EffectHandler(coordStore);
    store = new StoreManager(effectHandler);

    app = express();
    app.use(express.json());
    app.use('/api/cards', createCardRoutes(store));
  });

  describe('POST /api/cards', () => {
    it('creates a card and returns 201', async () => {
      const res = await request(app)
        .post('/api/cards')
        .send({ name: 'Test Task', promptBody: 'Fix the bug', projectPath: '/tmp' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Test Task');
      expect(res.body.id).toMatch(/^card_/);
      expect(res.body.source).toBe('manual');
      expect(res.body.column).toBe('backlog');
    });
  });

  describe('GET /api/cards', () => {
    it('returns empty list initially', async () => {
      const res = await request(app).get('/api/cards');
      expect(res.status).toBe(200);
      expect(res.body.cards).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('returns created cards', async () => {
      await request(app).post('/api/cards').send({ name: 'Card 1' });
      await request(app).post('/api/cards').send({ name: 'Card 2' });

      const res = await request(app).get('/api/cards');
      expect(res.body.total).toBe(2);
      expect(res.body.cards).toHaveLength(2);
    });

    it('filters by column', async () => {
      await request(app).post('/api/cards').send({ name: 'Backlog', column: 'backlog' });
      await request(app).post('/api/cards').send({ name: 'Done', column: 'done' });

      const res = await request(app).get('/api/cards?column=backlog');
      expect(res.body.total).toBe(1);
      expect(res.body.cards[0].name).toBe('Backlog');
    });

    it('supports pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app).post('/api/cards').send({ name: `Card ${i}` });
      }

      const res = await request(app).get('/api/cards?offset=2&limit=2');
      expect(res.body.cards).toHaveLength(2);
      expect(res.body.total).toBe(5);
    });
  });

  describe('PATCH /api/cards/:id', () => {
    it('renames a card', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Old Name' });
      const id = create.body.id;

      const res = await request(app).patch(`/api/cards/${id}`).send({ name: 'New Name' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('New Name');
    });

    it('moves a card to a different column', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Move Me' });
      const id = create.body.id;

      const res = await request(app).patch(`/api/cards/${id}`).send({ column: 'in_progress' });
      expect(res.body.column).toBe('in_progress');
    });

    it('returns 404 for nonexistent card', async () => {
      const res = await request(app).patch('/api/cards/nonexistent').send({ name: 'X' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/cards/:id', () => {
    it('deletes a card and returns 204', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Delete Me' });
      const id = create.body.id;

      const res = await request(app).delete(`/api/cards/${id}`);
      expect(res.status).toBe(204);

      // Verify it's gone
      const list = await request(app).get('/api/cards');
      expect(list.body.total).toBe(0);
    });

    it('returns 404 for nonexistent card', async () => {
      const res = await request(app).delete('/api/cards/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/cards/:id/archive', () => {
    it('archives a card', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Archive Me' });
      const id = create.body.id;

      const res = await request(app).post(`/api/cards/${id}/archive`);
      expect(res.status).toBe(200);
      expect(res.body.column).toBe('all_sessions');
      expect(res.body.manuallyArchived).toBe(true);
    });
  });

  describe('POST /api/cards/:id/launch', () => {
    it('sets card to in_progress with isLaunching', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Launch Me', projectPath: '/tmp' });
      const id = create.body.id;

      const res = await request(app).post(`/api/cards/${id}/launch`).send({
        prompt: 'Fix the bug',
        projectPath: '/tmp/repo',
      });

      expect(res.status).toBe(200);
      expect(res.body.column).toBe('in_progress');
      expect(res.body.isLaunching).toBe(true);
      expect(res.body.tmuxLink).not.toBeNull();
    });
  });

  describe('POST /api/cards/:id/queued-prompts', () => {
    it('creates a queued prompt and returns 201', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Task' });
      const id = create.body.id;

      const res = await request(app)
        .post(`/api/cards/${id}/queued-prompts`)
        .send({ body: 'Run the tests', sendAutomatically: false });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^qp_/);
      expect(res.body.body).toBe('Run the tests');
      expect(res.body.sendAutomatically).toBe(false);
    });

    it('returns 400 when body is missing', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Task' });
      const id = create.body.id;

      const res = await request(app)
        .post(`/api/cards/${id}/queued-prompts`)
        .send({ sendAutomatically: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('body is required');
    });

    it('returns 404 for nonexistent card', async () => {
      const res = await request(app)
        .post('/api/cards/nonexistent/queued-prompts')
        .send({ body: 'hello', sendAutomatically: false });

      expect(res.status).toBe(404);
    });

    it('trims the prompt body', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Task' });
      const id = create.body.id;

      const res = await request(app)
        .post(`/api/cards/${id}/queued-prompts`)
        .send({ body: '  spaces  ', sendAutomatically: false });

      expect(res.status).toBe(201);
      expect(res.body.body).toBe('spaces');
    });
  });

  describe('DELETE /api/cards/:id/queued-prompts/:pid', () => {
    it('removes a queued prompt', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Task' });
      const id = create.body.id;

      const addRes = await request(app)
        .post(`/api/cards/${id}/queued-prompts`)
        .send({ body: 'Do this', sendAutomatically: false });
      const pid = addRes.body.id;

      const delRes = await request(app).delete(`/api/cards/${id}/queued-prompts/${pid}`);
      expect(delRes.status).toBe(200);
    });

    it('returns 404 for nonexistent card', async () => {
      const res = await request(app).delete('/api/cards/nonexistent/queued-prompts/qp_123');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/cards/:id/queued-prompts/:pid/send', () => {
    it('returns 404 when prompt does not exist', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Task' });
      const id = create.body.id;

      const res = await request(app).post(`/api/cards/${id}/queued-prompts/qp_bogus/send`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Prompt not found');
    });

    it('returns 404 when card does not exist', async () => {
      const res = await request(app).post('/api/cards/nonexistent/queued-prompts/qp_123/send');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/cards/:id/queued-prompts/:pid', () => {
    it('updates a queued prompt', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Task' });
      const id = create.body.id;

      await request(app)
        .post(`/api/cards/${id}/queued-prompts`)
        .send({ body: 'Old body', sendAutomatically: false });

      const res = await request(app)
        .patch(`/api/cards/${id}/queued-prompts/qp_bogus`)
        .send({ body: 'New body', sendAutomatically: true });

      expect(res.status).toBe(200);
    });

    it('returns 404 for nonexistent card', async () => {
      const res = await request(app)
        .patch('/api/cards/nonexistent/queued-prompts/qp_123')
        .send({ body: 'x' });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/cards/:id — column validation', () => {
    it('returns 422 when moving to in_review with no PRs', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'No PR Card' });
      const id = create.body.id;

      const res = await request(app).patch(`/api/cards/${id}`).send({ column: 'in_review' });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/In Review/i);
    });

    it('returns 422 when moving to done with no merged PR', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'No Merged PR' });
      const id = create.body.id;

      const res = await request(app).patch(`/api/cards/${id}`).send({ column: 'done' });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/done/i);
    });

    it('allows moving to backlog without restriction', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Move to Backlog' });
      const id = create.body.id;

      const res = await request(app).patch(`/api/cards/${id}`).send({ column: 'backlog' });
      expect(res.status).toBe(200);
      expect(res.body.column).toBe('backlog');
    });

    it('allows moving to requires_attention without restriction', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Needs Attention' });
      const id = create.body.id;

      const res = await request(app).patch(`/api/cards/${id}`).send({ column: 'requires_attention' });
      expect(res.status).toBe(200);
      expect(res.body.column).toBe('requires_attention');
    });
  });

  describe('POST /api/cards/:id/fork', () => {
    it('returns 404 for nonexistent card', async () => {
      const res = await request(app).post('/api/cards/nonexistent/fork');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Card not found');
    });

    it('returns 400 when card has no session', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'No Session Card' });
      const id = create.body.id;

      const res = await request(app).post(`/api/cards/${id}/fork`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No session to fork');
    });
  });

  describe('POST /api/cards/:id/send-prompt', () => {
    it('returns 404 for nonexistent card', async () => {
      const res = await request(app)
        .post('/api/cards/nonexistent/send-prompt')
        .send({ body: 'hello' });
      expect(res.status).toBe(404);
    });

    it('returns 400 when card has no running session', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Idle Card' });
      const id = create.body.id;

      const res = await request(app)
        .post(`/api/cards/${id}/send-prompt`)
        .send({ body: 'Do this' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No running session');
    });

    it('returns 400 when body is missing', async () => {
      const create = await request(app).post('/api/cards').send({ name: 'Idle Card' });
      const id = create.body.id;

      const res = await request(app)
        .post(`/api/cards/${id}/send-prompt`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No running session');
    });
  });
});
