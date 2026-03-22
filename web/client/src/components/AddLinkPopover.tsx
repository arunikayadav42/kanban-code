/**
 * AddLinkPopover -- popover for manually adding a Branch, Issue, or PR link to a card.
 *
 * Swift source: Sources/KanbanCode/AddLinkPopover.swift
 *
 * Features: segmented picker (Branch/Issue/PR), input field, Add button,
 * callbacks onAddBranch/onAddIssue/onAddPR.
 */

import React, { useState, useCallback } from 'react';

// MARK: - Props

type LinkType = 'branch' | 'issue' | 'pr';

export interface AddLinkPopoverProps {
  onAddBranch?: (branch: string) => void;
  onAddIssue?: (number: number) => void;
  onAddPR?: (number: number) => void;
}

// MARK: - Component

export default function AddLinkPopover({
  onAddBranch,
  onAddIssue,
  onAddPR,
}: AddLinkPopoverProps): React.ReactElement {
  const [linkType, setLinkType] = useState<LinkType>('branch');
  const [branchText, setBranchText] = useState('');
  const [numberText, setNumberText] = useState('');

  const isAddDisabled = linkType === 'branch'
    ? branchText.trim().length === 0
    : !/^\d+$/.test(numberText.trim()) || parseInt(numberText.trim(), 10) <= 0;

  const handleAdd = useCallback(() => {
    if (linkType === 'branch') {
      const branch = branchText.trim();
      if (branch.length === 0) return;
      onAddBranch?.(branch);
    } else {
      const num = parseInt(numberText.trim(), 10);
      if (isNaN(num) || num <= 0) return;
      if (linkType === 'pr') {
        onAddPR?.(num);
      } else {
        onAddIssue?.(num);
      }
    }
  }, [linkType, branchText, numberText, onAddBranch, onAddIssue, onAddPR]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !isAddDisabled) {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd, isAddDisabled],
  );

  return (
    <div
      data-testid="add-link-popover"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        width: 220,
      }}
    >
      {/* Title */}
      <span style={{ fontWeight: 600, fontSize: 13 }}>Add Link</span>

      {/* Segmented picker */}
      <div
        data-testid="link-type-picker"
        style={{
          display: 'flex',
          borderRadius: 6,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.15)',
        }}
      >
        {(['branch', 'issue', 'pr'] as const).map((type) => (
          <button
            key={type}
            data-testid={`picker-${type}`}
            onClick={() => setLinkType(type)}
            style={{
              flex: 1,
              padding: '4px 0',
              border: 'none',
              fontSize: 12,
              cursor: 'pointer',
              backgroundColor: linkType === type ? 'rgba(0, 122, 255, 0.3)' : 'transparent',
              color: linkType === type ? '#fff' : 'rgba(255,255,255,0.6)',
              fontWeight: linkType === type ? 600 : 400,
            }}
          >
            {type === 'branch' ? 'Branch' : type === 'issue' ? 'Issue' : 'PR'}
          </button>
        ))}
      </div>

      {/* Input field */}
      {linkType === 'branch' ? (
        <input
          data-testid="branch-input"
          type="text"
          value={branchText}
          onChange={(e) => setBranchText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Branch name"
          style={inputStyle}
        />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'rgba(255,255,255,0.4)' }}>#</span>
          <input
            data-testid="number-input"
            type="text"
            value={numberText}
            onChange={(e) => setNumberText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Number"
            style={{ ...inputStyle, width: 80 }}
          />
        </div>
      )}

      {/* Add button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          data-testid="add-link-button"
          onClick={handleAdd}
          disabled={isAddDisabled}
          style={{
            padding: '4px 12px',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            cursor: isAddDisabled ? 'default' : 'pointer',
            backgroundColor: isAddDisabled ? 'rgba(0, 122, 255, 0.2)' : '#007AFF',
            color: '#fff',
            opacity: isAddDisabled ? 0.5 : 1,
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// MARK: - Style Constants

const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6,
  backgroundColor: 'transparent',
  color: 'inherit',
  fontSize: 12,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};
