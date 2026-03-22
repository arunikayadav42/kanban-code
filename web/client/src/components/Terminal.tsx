import React, { useRef } from 'react';
import { useTerminal } from '../hooks/useTerminal.js';
import '@xterm/xterm/css/xterm.css';

/**
 * Embedded terminal component — xterm.js connected to tmux via WebSocket.
 *
 * Swift equivalent: Sources/KanbanCode/TerminalRepresentable.swift
 * Spec: Section 4 (Terminal Protocol), Section 7.4 (Terminal Tab)
 */

interface TerminalProps {
  sessionName: string;
  fontSize?: number;
  onExit?: (code: number) => void;
}

export default function TerminalView({ sessionName, fontSize = 12, onExit }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useTerminal(containerRef, { sessionName, fontSize, onExit });

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 200,
        background: 'var(--terminal-bg, #121212)',
        overflow: 'hidden',
      }}
    />
  );
}
