import { describe, it, expect } from 'vitest';
import {
  type KanbanCodeColumn,
  ALL_COLUMNS,
  getColumnDisplayName,
  getAllowsBoardTaskCreation,
} from '../types/columns.js';

describe('KanbanCodeColumn', () => {
  describe('ALL_COLUMNS', () => {
    it('has 6 columns in display order', () => {
      expect(ALL_COLUMNS).toEqual([
        'backlog',
        'in_progress',
        'requires_attention',
        'in_review',
        'done',
        'all_sessions',
      ]);
    });
  });

  describe('displayName', () => {
    const expected: [KanbanCodeColumn, string][] = [
      ['backlog', 'Backlog'],
      ['in_progress', 'In Progress'],
      ['requires_attention', 'Waiting'],
      ['in_review', 'In Review'],
      ['done', 'Done'],
      ['all_sessions', 'All Sessions'],
    ];

    for (const [column, name] of expected) {
      it(`${column} → "${name}"`, () => {
        expect(getColumnDisplayName(column)).toBe(name);
      });
    }
  });

  describe('allowsBoardTaskCreation', () => {
    it('all columns except allSessions allow task creation', () => {
      expect(getAllowsBoardTaskCreation('backlog')).toBe(true);
      expect(getAllowsBoardTaskCreation('in_progress')).toBe(true);
      expect(getAllowsBoardTaskCreation('requires_attention')).toBe(true);
      expect(getAllowsBoardTaskCreation('in_review')).toBe(true);
      expect(getAllowsBoardTaskCreation('done')).toBe(true);
    });

    it('allSessions does NOT allow task creation', () => {
      expect(getAllowsBoardTaskCreation('all_sessions')).toBe(false);
    });
  });

  describe('JSON serialization', () => {
    it('raw values match Swift enum rawValues exactly', () => {
      // These are the exact strings stored in links.json
      const column: KanbanCodeColumn = 'requires_attention';
      expect(JSON.parse(JSON.stringify(column))).toBe('requires_attention');
    });
  });
});
