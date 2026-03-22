import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import PRBadge from '../PRBadge';
import type { PRStatus } from '@kanban-code/shared';

describe('PRBadge', () => {
  describe('PR number display', () => {
    it('renders PR number with hash prefix', () => {
      render(<PRBadge status={null} prNumber={42} />);
      expect(screen.getByText('#42')).toBeDefined();
    });

    it('renders large PR number', () => {
      render(<PRBadge status="approved" prNumber={12345} />);
      expect(screen.getByText('#12345')).toBeDefined();
    });
  });

  describe('Status colors', () => {
    const statusColors: [PRStatus | null, string][] = [
      ['failing', 'rgb(239, 68, 68)'],
      ['unresolved', 'rgb(249, 115, 22)'],
      ['changes_requested', 'rgb(249, 115, 22)'],
      ['review_needed', 'rgb(234, 179, 8)'],
      ['pending_ci', 'rgb(234, 179, 8)'],
      ['approved', 'rgb(34, 197, 94)'],
      ['merged', 'rgb(168, 85, 247)'],
      ['closed', 'rgb(107, 114, 128)'],
      [null, 'rgb(142, 142, 147)'],
    ];

    it.each(statusColors)('applies correct color for status=%s', (status, expectedColor) => {
      const { container } = render(<PRBadge status={status} prNumber={1} />);
      const badge = container.querySelector('[data-testid="pr-badge"]') as HTMLElement;
      expect(badge).not.toBeNull();
      expect(badge.style.color).toBe(expectedColor);
    });
  });

  describe('Approved checkmark', () => {
    it('shows checkmark icon for approved status', () => {
      const { container } = render(<PRBadge status="approved" prNumber={10} />);
      const svgs = container.querySelectorAll('svg');
      // Should have the checkmark SVG
      expect(svgs.length).toBeGreaterThanOrEqual(1);
    });

    it('does not show checkmark for non-approved status', () => {
      const { container } = render(<PRBadge status="failing" prNumber={10} />);
      const badge = container.querySelector('[data-testid="pr-badge"]') as HTMLElement;
      // Only the text #10, no extra check icon
      const svgs = badge.querySelectorAll('svg');
      expect(svgs.length).toBe(0);
    });
  });

  describe('Unresolved threads', () => {
    it('shows unresolved thread count when > 0', () => {
      render(<PRBadge status="review_needed" prNumber={5} unresolvedThreads={3} />);
      expect(screen.getByText('3')).toBeDefined();
      const el = screen.getByTestId('unresolved-threads');
      expect(el).toBeDefined();
    });

    it('does not show threads indicator when count is 0', () => {
      const { container } = render(
        <PRBadge status="review_needed" prNumber={5} unresolvedThreads={0} />,
      );
      expect(container.querySelector('[data-testid="unresolved-threads"]')).toBeNull();
    });

    it('defaults unresolvedThreads to 0', () => {
      const { container } = render(<PRBadge status="review_needed" prNumber={5} />);
      expect(container.querySelector('[data-testid="unresolved-threads"]')).toBeNull();
    });
  });

  describe('Badge appearance', () => {
    it('renders as a pill shape (large border-radius)', () => {
      const { container } = render(<PRBadge status="merged" prNumber={99} />);
      const badge = container.querySelector('[data-testid="pr-badge"]') as HTMLElement;
      expect(badge.style.borderRadius).toBe('9999px');
    });

    it('has translucent background based on status color', () => {
      const { container } = render(<PRBadge status="failing" prNumber={1} />);
      const badge = container.querySelector('[data-testid="pr-badge"]') as HTMLElement;
      // Background should be rgba version of the color with 0.15 alpha
      expect(badge.style.backgroundColor).toContain('rgba(239, 68, 68, 0.15)');
    });
  });
});
