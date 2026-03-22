import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import ColumnView from '../ColumnView';
import type { Link } from '@kanban-code/shared';
import { createLink } from '@kanban-code/shared';

function makeLink(overrides: Partial<Link> & { id: string }): Link {
  return createLink({
    column: 'backlog',
    source: 'manual',
    projectPath: '/test/project',
    ...overrides,
  });
}

/** Wraps component in DndContext required by useDroppable/useSortable hooks. */
function renderWithDnd(ui: React.ReactElement) {
  return render(<DndContext>{ui}</DndContext>);
}

describe('ColumnView', () => {
  describe('Header', () => {
    it('renders column display name', () => {
      renderWithDnd(<ColumnView column="backlog" cards={[]} />);
      expect(screen.getByText('Backlog')).toBeDefined();
    });

    it('renders In Progress display name', () => {
      renderWithDnd(<ColumnView column="in_progress" cards={[]} />);
      expect(screen.getByText('In Progress')).toBeDefined();
    });

    it('renders Waiting display name', () => {
      renderWithDnd(<ColumnView column="requires_attention" cards={[]} />);
      expect(screen.getByText('Waiting')).toBeDefined();
    });

    it('renders In Review display name', () => {
      renderWithDnd(<ColumnView column="in_review" cards={[]} />);
      expect(screen.getByText('In Review')).toBeDefined();
    });

    it('renders Done display name', () => {
      renderWithDnd(<ColumnView column="done" cards={[]} />);
      expect(screen.getByText('Done')).toBeDefined();
    });

    it('renders All Sessions display name', () => {
      renderWithDnd(<ColumnView column="all_sessions" cards={[]} />);
      expect(screen.getByText('All Sessions')).toBeDefined();
    });
  });

  describe('Card count badge', () => {
    it('shows 0 for empty column', () => {
      renderWithDnd(<ColumnView column="backlog" cards={[]} />);
      expect(screen.getByText('0')).toBeDefined();
    });

    it('shows correct count for cards', () => {
      const cards = [
        makeLink({ id: 'c1', name: 'Card 1' }),
        makeLink({ id: 'c2', name: 'Card 2' }),
        makeLink({ id: 'c3', name: 'Card 3' }),
      ];
      renderWithDnd(<ColumnView column="backlog" cards={cards} />);
      expect(screen.getByText('3')).toBeDefined();
    });
  });

  describe('Card rendering', () => {
    it('renders card titles', () => {
      const cards = [
        makeLink({ id: 'c1', name: 'Fix auth bug' }),
        makeLink({ id: 'c2', name: 'Add dark mode' }),
      ];
      renderWithDnd(<ColumnView column="backlog" cards={cards} />);
      expect(screen.getByText('Fix auth bug')).toBeDefined();
      expect(screen.getByText('Add dark mode')).toBeDefined();
    });

    it('renders no cards when list is empty', () => {
      const { container } = renderWithDnd(<ColumnView column="backlog" cards={[]} />);
      const cardElements = container.querySelectorAll('[data-testid="card"]');
      expect(cardElements.length).toBe(0);
    });
  });

  describe('Selection', () => {
    it('marks selected card', () => {
      const cards = [
        makeLink({ id: 'c1', name: 'Selected card' }),
        makeLink({ id: 'c2', name: 'Other card' }),
      ];
      const { container } = renderWithDnd(
        <ColumnView column="backlog" cards={cards} selectedCardId="c1" />,
      );
      const selectedCard = container.querySelector('[data-selected="true"]');
      expect(selectedCard).not.toBeNull();
    });
  });

  describe('Column sizing', () => {
    it('applies min/max width via style', () => {
      const { container } = renderWithDnd(
        <ColumnView column="backlog" cards={[]} />,
      );
      const column = container.firstElementChild as HTMLElement;
      expect(column.style.minWidth).toBe('240px');
      expect(column.style.maxWidth).toBe('360px');
    });
  });

  describe('Glass-style header', () => {
    it('header has backdrop-filter for glass effect', () => {
      const { container } = renderWithDnd(
        <ColumnView column="backlog" cards={[]} />,
      );
      const header = container.querySelector('[data-testid="column-header"]') as HTMLElement;
      expect(header).not.toBeNull();
      expect(header.style.backdropFilter).toContain('blur');
    });
  });

  describe('Droppable zone', () => {
    it('renders with droppable data attributes', () => {
      const { container } = renderWithDnd(
        <ColumnView column="backlog" cards={[]} />,
      );
      const droppable = container.querySelector('[data-column="backlog"]');
      expect(droppable).not.toBeNull();
    });
  });
});
