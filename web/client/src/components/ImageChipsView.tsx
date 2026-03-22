/**
 * ImageChipsView -- horizontal strip of image attachment chips.
 *
 * Swift source: Sources/KanbanCode/ImageChipsView.swift
 *
 * Each chip shows "Image #N" label, a remove button, and a hover preview popup.
 * Used in prompt sections for image attachments.
 */

import React, { useState, useRef, useEffect } from 'react';
import type { ImageAttachment } from '@kanban-code/shared';

// MARK: - Props

interface ImageChipsViewProps {
  images: ImageAttachment[];
  onRemove: (id: string) => void;
}

// MARK: - Component

export default function ImageChipsView({
  images,
  onRemove,
}: ImageChipsViewProps): React.ReactElement | null {
  if (images.length === 0) return null;

  return (
    <div
      data-testid="image-chips"
      style={{
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        height: 28,
        alignItems: 'center',
        scrollbarWidth: 'none',
      }}
    >
      {images.map((image, index) => (
        <ImageChip
          key={image.id}
          index={index + 1}
          imageData={image.data}
          onRemove={() => onRemove(image.id)}
        />
      ))}
    </div>
  );
}

// MARK: - ImageChip

interface ImageChipProps {
  index: number;
  imageData: string;
  onRemove: () => void;
}

function ImageChip({ index, imageData, onRemove }: ImageChipProps): React.ReactElement {
  const [isHovering, setIsHovering] = useState(false);
  const chipRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (isHovering && chipRef.current) {
      const rect = chipRef.current.getBoundingClientRect();
      setPopoverPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    } else {
      setPopoverPosition(null);
    }
  }, [isHovering]);

  return (
    <>
      <div
        ref={chipRef}
        data-testid="image-chip"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          backgroundColor: 'rgba(128, 128, 128, 0.15)',
          borderRadius: 6,
          flexShrink: 0,
          cursor: 'default',
          fontSize: 12,
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <PhotoIcon />
        <span style={{ fontSize: 12 }}>Image #{index}</span>
        <button
          data-testid="image-chip-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove image ${index}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'none',
            padding: 0,
            cursor: 'pointer',
            color: 'var(--color-secondary, #8e8e93)',
            lineHeight: 1,
          }}
        >
          <CloseCircleIcon />
        </button>
      </div>

      {/* Hover preview popup */}
      {isHovering && popoverPosition && (
        <div
          data-testid="image-preview"
          style={{
            position: 'fixed',
            top: popoverPosition.top,
            left: popoverPosition.left,
            zIndex: 1000,
            padding: 4,
            backgroundColor: 'var(--color-bg, #1c1c1e)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(128, 128, 128, 0.2)',
            pointerEvents: 'none',
          }}
        >
          <img
            src={`data:image/png;base64,${imageData}`}
            alt={`Preview of image ${index}`}
            style={{
              maxWidth: 300,
              maxHeight: 300,
              objectFit: 'contain',
              borderRadius: 4,
              display: 'block',
            }}
          />
        </div>
      )}
    </>
  );
}

// MARK: - Icons

function PhotoIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" opacity={0.6}>
      <path fillRule="evenodd" d="M1.75 2.5a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h.94l4.72-6.03a.75.75 0 011.18 0L13.28 13.5h.97a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm5.5 3a.5.5 0 11-1 0 .5.5 0 011 0zM5 4.25a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
    </svg>
  );
}

function CloseCircleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M8 16A8 8 0 108 0a8 8 0 000 16zM4.22 4.22a.75.75 0 011.06 0L8 6.94l2.72-2.72a.75.75 0 111.06 1.06L9.06 8l2.72 2.72a.75.75 0 11-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 01-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 010-1.06z" />
    </svg>
  );
}
