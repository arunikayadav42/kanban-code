/**
 * AssistantIcon -- renders an SVG icon for a coding assistant.
 *
 * Uses the descriptor-driven plugin system to look up the SVG path
 * and viewBox per assistant. Falls back to a generic code-brackets
 * icon for unknown assistants.
 */

import React from 'react';
import type { CodingAssistant } from '@kanban-code/shared';
import { getDisplayName, getDescriptor } from '@kanban-code/shared';

interface AssistantIconProps {
  assistant: CodingAssistant;
  size?: number;
}

/** Fallback SVG path: generic code brackets */
const FALLBACK_SVG_PATH = 'M5.5 3L2 8l3.5 5h1L3.5 8 6.5 3h-1Zm5 0h-1L12.5 8 9.5 13h1L14 8 10.5 3Z';

export default function AssistantIcon({
  assistant,
  size = 14,
}: AssistantIconProps): React.ReactElement {
  const desc = getDescriptor(assistant);
  const svgPath = desc?.icon?.svgPath ?? FALLBACK_SVG_PATH;
  const viewBox = desc?.icon?.viewBox ?? '0 0 16 16';

  return (
    <span
      data-testid="assistant-icon"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
      }}
      title={getDisplayName(assistant)}
    >
      <svg width={size} height={size} viewBox={viewBox} fill="currentColor">
        <path d={svgPath} opacity={0.7} />
      </svg>
    </span>
  );
}
