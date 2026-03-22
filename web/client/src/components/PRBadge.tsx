/**
 * PRBadge -- colored pill showing PR number, status icon, and unresolved threads.
 *
 * Swift source: Sources/KanbanCode/PRBadge.swift
 *
 * Color mapping:
 *   red = failing, orange = unresolved/changes_requested,
 *   blue = review_needed, yellow = pending_ci,
 *   green = approved, purple = merged, gray = closed
 */

import React from 'react';
import type { PRStatus } from '@kanban-code/shared';
import { PR_STATUS_COLORS } from '@kanban-code/shared';

// MARK: - Props

export interface PRBadgeProps {
  status: PRStatus | null;
  prNumber: number;
  unresolvedThreads?: number;
}

// MARK: - Component

export default function PRBadge({
  status,
  prNumber,
  unresolvedThreads = 0,
}: PRBadgeProps): React.ReactElement {
  const color = getBadgeColor(status);

  return (
    <span
      data-testid="pr-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 10,
        fontWeight: 500,
        color,
        backgroundColor: hexToRgba(color, 0.15),
        borderRadius: 9999,
        padding: '2px 5px',
        lineHeight: 1.3,
      }}
    >
      {status === 'approved' && <CheckIcon />}
      <span style={{ fontFamily: 'ui-rounded, system-ui, sans-serif' }}>
        #{prNumber}
      </span>
      {unresolvedThreads > 0 && (
        <span
          data-testid="unresolved-threads"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            color: '#f97316',
          }}
        >
          <CommentIcon />
          <span style={{ fontSize: 9, fontWeight: 500 }}>
            {unresolvedThreads}
          </span>
        </span>
      )}
    </span>
  );
}

// MARK: - Color mapping

function getBadgeColor(status: PRStatus | null): string {
  return PR_STATUS_COLORS[status ?? 'default'] ?? PR_STATUS_COLORS.default;
}

// MARK: - Helpers

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// MARK: - Icons

function CheckIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="7" height="7" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.573 2.573A1.458 1.458 0 014 13.543V12H2.75A1.75 1.75 0 011 10.25v-7.5z" />
    </svg>
  );
}
