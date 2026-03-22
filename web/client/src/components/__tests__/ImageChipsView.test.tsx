import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ImageChipsView from '../ImageChipsView';
import type { ImageAttachment } from '@kanban-code/shared';

function makeImage(id: string, data = 'iVBORw0KGgo='): ImageAttachment {
  return { id, data };
}

describe('ImageChipsView', () => {
  describe('Rendering', () => {
    it('returns null when images array is empty', () => {
      const { container } = render(
        <ImageChipsView images={[]} onRemove={vi.fn()} />,
      );
      expect(container.querySelector('[data-testid="image-chips"]')).toBeNull();
    });

    it('renders chips for each image', () => {
      const images = [makeImage('img-1'), makeImage('img-2'), makeImage('img-3')];
      render(<ImageChipsView images={images} onRemove={vi.fn()} />);
      const chips = screen.getAllByTestId('image-chip');
      expect(chips.length).toBe(3);
    });

    it('displays "Image #N" label starting at 1', () => {
      const images = [makeImage('a'), makeImage('b')];
      render(<ImageChipsView images={images} onRemove={vi.fn()} />);
      expect(screen.getByText('Image #1')).toBeDefined();
      expect(screen.getByText('Image #2')).toBeDefined();
    });
  });

  describe('Remove button', () => {
    it('calls onRemove with image id when remove button clicked', () => {
      const onRemove = vi.fn();
      const images = [makeImage('img-42')];
      render(<ImageChipsView images={images} onRemove={onRemove} />);
      const removeBtn = screen.getByRole('button', { name: /remove image 1/i });
      fireEvent.click(removeBtn);
      expect(onRemove).toHaveBeenCalledWith('img-42');
    });

    it('each chip has a remove button', () => {
      const images = [makeImage('a'), makeImage('b'), makeImage('c')];
      render(<ImageChipsView images={images} onRemove={vi.fn()} />);
      const removeBtns = screen.getAllByTestId('image-chip-remove');
      expect(removeBtns.length).toBe(3);
    });
  });

  describe('Hover preview', () => {
    it('shows preview popup on mouse enter', () => {
      const images = [makeImage('img-1', 'AAAA')];
      const { container } = render(
        <ImageChipsView images={images} onRemove={vi.fn()} />,
      );
      const chip = screen.getByTestId('image-chip');

      // Before hover: no preview
      expect(container.querySelector('[data-testid="image-preview"]')).toBeNull();

      // Hover over chip
      fireEvent.mouseEnter(chip);
      expect(screen.getByTestId('image-preview')).toBeDefined();

      // Check img src has base64 data
      const img = screen.getByAltText('Preview of image 1');
      expect(img.getAttribute('src')).toContain('data:image/png;base64,AAAA');
    });

    it('hides preview popup on mouse leave', () => {
      const images = [makeImage('img-1')];
      render(<ImageChipsView images={images} onRemove={vi.fn()} />);
      const chip = screen.getByTestId('image-chip');

      fireEvent.mouseEnter(chip);
      expect(screen.getByTestId('image-preview')).toBeDefined();

      fireEvent.mouseLeave(chip);
      expect(screen.queryByTestId('image-preview')).toBeNull();
    });
  });

  describe('Accessibility', () => {
    it('remove buttons have aria-label with image index', () => {
      const images = [makeImage('a'), makeImage('b')];
      render(<ImageChipsView images={images} onRemove={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Remove image 1' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Remove image 2' })).toBeDefined();
    });
  });

  describe('Layout', () => {
    it('renders as a horizontal strip', () => {
      const images = [makeImage('a'), makeImage('b')];
      const { container } = render(
        <ImageChipsView images={images} onRemove={vi.fn()} />,
      );
      const strip = container.querySelector('[data-testid="image-chips"]') as HTMLElement;
      expect(strip.style.display).toBe('flex');
      expect(strip.style.overflowX).toBe('auto');
    });
  });
});
