import React from 'react';
import type { CodingAssistant } from '@kanban-code/shared';
import { getShortDisplayName, getAssistantColor, getDescriptor } from '@kanban-code/shared';

export interface AssistantPillProps {
  assistant: CodingAssistant;
}

export default function AssistantPill({ assistant }: AssistantPillProps): React.ReactElement {
  const name = getShortDisplayName(assistant);
  const color = getAssistantColor(assistant);
  const desc = getDescriptor(assistant);
  const svgPath = desc?.icon?.svgPath;
  const viewBox = desc?.icon?.viewBox ?? '0 0 16 16';

  return (
    <span
      title={name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 8,
        fontWeight: 700,
        color: '#fff',
        backgroundColor: color,
        borderRadius: 9999,
        padding: '2px 5px',
        textTransform: 'uppercase',
        letterSpacing: 0.3,
      }}
    >
      {svgPath && (
        <svg width={10} height={10} viewBox={viewBox} fill="currentColor" style={{ flexShrink: 0 }}>
          <path d={svgPath} opacity={0.9} />
        </svg>
      )}
      {name}
    </span>
  );
}
