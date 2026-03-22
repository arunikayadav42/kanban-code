/**
 * Represents the current activity state of a coding assistant session.
 *
 * Swift source: Sources/KanbanCodeCore/Domain/Entities/ActivityState.swift
 * Spec: Section 7.6 (Timing Constants), Section 7.8 (Activity Detection Invariants)
 */

export type ActivityState =
  | 'actively_working'
  | 'needs_attention'
  | 'idle_waiting'
  | 'ended'
  | 'stale';

/**
 * Priority for composite activity detection: higher = more informative.
 * Used by CompositeActivityDetector to pick the best state when multiple
 * detectors report on the same session.
 */
export function getActivityPriority(state: ActivityState): number {
  switch (state) {
    case 'actively_working': return 5;
    case 'needs_attention': return 4;
    case 'idle_waiting': return 3;
    case 'ended': return 2;
    case 'stale': return 1;
  }
}

/** Compare two activity states by priority (higher priority wins). */
export function higherPriorityState(a: ActivityState, b: ActivityState): ActivityState {
  return getActivityPriority(a) >= getActivityPriority(b) ? a : b;
}
