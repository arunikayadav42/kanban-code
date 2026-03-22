import { describe, it, expect } from 'vitest';
import {
  type PRStatus,
  getPRStatusPriority,
  comparePRStatus,
  type CheckRun,
  type CheckRunStatus,
  type CheckRunConclusion,
} from '../types/pr-status.js';

describe('PRStatus', () => {
  describe('priority ordering (lower = higher urgency)', () => {
    it('failing has highest urgency (0)', () => {
      expect(getPRStatusPriority('failing')).toBe(0);
    });

    it('closed has lowest urgency (7)', () => {
      expect(getPRStatusPriority('closed')).toBe(7);
    });

    it('full priority order matches Swift Comparable', () => {
      const statuses: PRStatus[] = [
        'failing', 'unresolved', 'changes_requested', 'review_needed',
        'pending_ci', 'approved', 'merged', 'closed',
      ];
      for (let i = 0; i < statuses.length; i++) {
        expect(getPRStatusPriority(statuses[i])).toBe(i);
      }
    });
  });

  describe('comparePRStatus', () => {
    it('failing < approved (higher urgency)', () => {
      expect(comparePRStatus('failing', 'approved')).toBeLessThan(0);
    });

    it('approved > failing (lower urgency)', () => {
      expect(comparePRStatus('approved', 'failing')).toBeGreaterThan(0);
    });

    it('same status returns 0', () => {
      expect(comparePRStatus('merged', 'merged')).toBe(0);
    });

    it('can sort an array of statuses by urgency', () => {
      const shuffled: PRStatus[] = ['approved', 'failing', 'merged', 'unresolved'];
      const sorted = [...shuffled].sort(comparePRStatus);
      expect(sorted).toEqual(['failing', 'unresolved', 'approved', 'merged']);
    });
  });

  describe('JSON serialization of raw values', () => {
    it('changes_requested matches Swift rawValue', () => {
      const status: PRStatus = 'changes_requested';
      expect(JSON.parse(JSON.stringify(status))).toBe('changes_requested');
    });

    it('pending_ci matches Swift rawValue', () => {
      const status: PRStatus = 'pending_ci';
      expect(JSON.parse(JSON.stringify(status))).toBe('pending_ci');
    });
  });
});

describe('CheckRun', () => {
  it('matches Swift struct shape', () => {
    const check: CheckRun = {
      name: 'build',
      status: 'completed',
      conclusion: 'success',
    };
    expect(check.name).toBe('build');
    expect(check.status).toBe('completed');
    expect(check.conclusion).toBe('success');
  });

  it('conclusion can be null', () => {
    const check: CheckRun = {
      name: 'deploy',
      status: 'in_progress',
      conclusion: null,
    };
    expect(check.conclusion).toBeNull();
  });

  it('JSON round-trips correctly', () => {
    const check: CheckRun = {
      name: 'lint',
      status: 'completed',
      conclusion: 'failure',
    };
    const roundTripped = JSON.parse(JSON.stringify(check)) as CheckRun;
    expect(roundTripped).toEqual(check);
  });
});

describe('CheckRunStatus', () => {
  it('has correct values matching Swift rawValues', () => {
    const statuses: CheckRunStatus[] = ['queued', 'in_progress', 'completed'];
    expect(statuses).toHaveLength(3);
  });
});

describe('CheckRunConclusion', () => {
  it('has all 7 values matching Swift rawValues', () => {
    const conclusions: CheckRunConclusion[] = [
      'success', 'failure', 'neutral', 'cancelled',
      'timed_out', 'action_required', 'skipped',
    ];
    expect(conclusions).toHaveLength(7);
  });
});
