import { describe, it, expect } from 'vitest';
import {
  type ActivityState,
  getActivityPriority,
  higherPriorityState,
} from '../types/activity-state.js';

describe('ActivityState', () => {
  describe('priority ordering', () => {
    it('activelyWorking has highest priority (5)', () => {
      expect(getActivityPriority('actively_working')).toBe(5);
    });

    it('needsAttention has priority 4', () => {
      expect(getActivityPriority('needs_attention')).toBe(4);
    });

    it('idleWaiting has priority 3', () => {
      expect(getActivityPriority('idle_waiting')).toBe(3);
    });

    it('ended has priority 2', () => {
      expect(getActivityPriority('ended')).toBe(2);
    });

    it('stale has lowest priority (1)', () => {
      expect(getActivityPriority('stale')).toBe(1);
    });
  });

  describe('higherPriorityState', () => {
    it('activelyWorking wins over everything', () => {
      const states: ActivityState[] = ['needs_attention', 'idle_waiting', 'ended', 'stale'];
      for (const s of states) {
        expect(higherPriorityState('actively_working', s)).toBe('actively_working');
        expect(higherPriorityState(s, 'actively_working')).toBe('actively_working');
      }
    });

    it('same state returns itself', () => {
      expect(higherPriorityState('ended', 'ended')).toBe('ended');
    });

    it('needsAttention beats idleWaiting', () => {
      expect(higherPriorityState('needs_attention', 'idle_waiting')).toBe('needs_attention');
    });
  });

  describe('JSON serialization', () => {
    it('values are valid JSON strings matching Swift rawValue', () => {
      const state: ActivityState = 'actively_working';
      expect(JSON.parse(JSON.stringify(state))).toBe('actively_working');
    });
  });
});
