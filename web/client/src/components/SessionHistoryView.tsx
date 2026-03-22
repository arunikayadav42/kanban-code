/**
 * SessionHistoryView -- renders conversation history for a coding session.
 *
 * Swift source: Sources/KanbanCode/SessionHistoryView.swift
 *
 * Features: turn blocks (user/assistant roles), search (debounced, min 2 chars),
 * checkpoint mode, auto-load earlier turns on scroll-near-top, copy buttons,
 * match navigation (up/down), scroll preservation during auto-load.
 */

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import type {
  ConversationTurn,
  ContentBlock,
  ContentBlockKind,
  CodingAssistant,
} from '@kanban-code/shared';
import { getHistoryPromptSymbol, ALL_ASSISTANTS } from '@kanban-code/shared';

// MARK: - Props

export interface SessionHistoryViewProps {
  turns: ConversationTurn[];
  isLoading: boolean;
  checkpointMode?: boolean;
  hasMoreTurns?: boolean;
  isLoadingMore?: boolean;
  assistant?: CodingAssistant;
  sessionPath?: string | null;
  onCancelCheckpoint?: () => void;
  onSelectTurn?: (turn: ConversationTurn) => void;
  onLoadMore?: () => void;
  onLoadAroundTurn?: (turnIndex: number) => void;
  onSearch?: (query: string) => Promise<number[]>;
}

// MARK: - Component

export default function SessionHistoryView({
  turns,
  isLoading,
  checkpointMode = false,
  hasMoreTurns = false,
  isLoadingMore = false,
  assistant = ALL_ASSISTANTS[0],
  sessionPath,
  onCancelCheckpoint,
  onSelectTurn,
  onLoadMore,
  onLoadAroundTurn,
  onSearch,
}: SessionHistoryViewProps): React.ReactElement {
  const [hoveredTurnIndex, setHoveredTurnIndex] = useState<number | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [searchMatchIndices, setSearchMatchIndices] = useState<number[]>([]);
  const [currentMatchPosition, setCurrentMatchPosition] = useState(0);
  const [isSearchScanning, setIsSearchScanning] = useState(false);
  const [autoLoadEnabled, setAutoLoadEnabled] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAtBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const isPreservingScrollRef = useRef(false);
  const prevSessionPathRef = useRef(sessionPath);

  const currentMatchTurnIndex = useMemo(() => {
    if (!showSearch || searchMatchIndices.length === 0 || currentMatchPosition >= searchMatchIndices.length) {
      return null;
    }
    return searchMatchIndices[currentMatchPosition];
  }, [showSearch, searchMatchIndices, currentMatchPosition]);

  // Arm auto-load with a delay to avoid loading on initial scroll-to-bottom
  const armAutoLoad = useCallback(() => {
    if (autoLoadTimerRef.current) clearTimeout(autoLoadTimerRef.current);
    setAutoLoadEnabled(false);
    autoLoadTimerRef.current = setTimeout(() => {
      setAutoLoadEnabled(true);
    }, 500);
  }, []);

  // Scroll to bottom
  const scrollToBottom = useCallback((force = false) => {
    if (!activeQuery && (force || isAtBottomRef.current)) {
      requestAnimationFrame(() => {
        const el = bottomAnchorRef.current;
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'instant', block: 'end' });
        }
      });
    }
  }, [activeQuery]);

  // Scroll to current search match
  const scrollToMatch = useCallback((position: number) => {
    if (searchMatchIndices.length === 0 || position >= searchMatchIndices.length) return;
    const idx = searchMatchIndices[position];
    const el = document.getElementById(`turn-${idx}`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [searchMatchIndices]);

  // On mount + turns change: scroll to bottom
  useEffect(() => {
    if (isPreservingScrollRef.current) {
      // Preserve scroll position when content is prepended
      const container = scrollContainerRef.current;
      if (container) {
        const newHeight = container.scrollHeight;
        const delta = newHeight - prevScrollHeightRef.current;
        if (delta > 0) {
          container.scrollTop += delta;
        }
        prevScrollHeightRef.current = newHeight;
      }
      isPreservingScrollRef.current = false;
    } else if (!activeQuery) {
      scrollToBottom();
    }
  }, [turns.length, scrollToBottom, activeQuery]);

  // Arm auto-load on mount and session path change
  useEffect(() => {
    armAutoLoad();
    return () => {
      if (autoLoadTimerRef.current) clearTimeout(autoLoadTimerRef.current);
    };
  }, [armAutoLoad]);

  useEffect(() => {
    if (sessionPath !== prevSessionPathRef.current) {
      prevSessionPathRef.current = sessionPath;
      setAutoLoadEnabled(false);
      isPreservingScrollRef.current = false;
      armAutoLoad();
    }
  }, [sessionPath, armAutoLoad]);

  // Initial scroll to bottom
  useEffect(() => {
    scrollToBottom(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcut: Cmd/Ctrl+F to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Scroll handler: detect near-top for auto-load, detect at-bottom for auto-scroll
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 50;
    isAtBottomRef.current = atBottom;

    const nearTop = scrollTop < 300;
    if (nearTop && hasMoreTurns && !isLoadingMore && autoLoadEnabled && !activeQuery) {
      prevScrollHeightRef.current = container.scrollHeight;
      isPreservingScrollRef.current = true;
      onLoadMore?.();
    }
  }, [hasMoreTurns, isLoadingMore, autoLoadEnabled, activeQuery, onLoadMore]);

  // Search debouncing
  const scheduleSearch = useCallback((text: string) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    if (text.length === 0) {
      setActiveQuery('');
      setSearchMatchIndices([]);
      setCurrentMatchPosition(0);
      setIsSearchScanning(false);
      return;
    }

    if (text.length < 2) return;

    debounceTimerRef.current = setTimeout(async () => {
      setActiveQuery(text);
      setIsSearchScanning(true);

      if (onSearch) {
        const matches = await onSearch(text);
        setSearchMatchIndices(matches);
        setIsSearchScanning(false);
        if (matches.length > 0) {
          setCurrentMatchPosition(matches.length - 1);
        }
      } else {
        // Client-side fallback: search loaded turns
        const matches: number[] = [];
        const lowerQuery = text.toLowerCase();
        for (const turn of turns) {
          const inPreview = turn.textPreview.toLowerCase().includes(lowerQuery);
          const inBlocks = turn.contentBlocks.some(b => b.text.toLowerCase().includes(lowerQuery));
          if (inPreview || inBlocks) {
            matches.push(turn.index);
          }
        }
        setSearchMatchIndices(matches);
        setIsSearchScanning(false);
        if (matches.length > 0) {
          setCurrentMatchPosition(matches.length - 1);
        }
      }
    }, 250);
  }, [onSearch, turns]);

  const handleSearchTextChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setSearchText(text);
    scheduleSearch(text);
  }, [scheduleSearch]);

  const navigateSearch = useCallback((forward: boolean) => {
    if (searchMatchIndices.length === 0) return;
    let nextPos: number;
    if (forward) {
      nextPos = (currentMatchPosition + 1) % searchMatchIndices.length;
    } else {
      nextPos = (currentMatchPosition - 1 + searchMatchIndices.length) % searchMatchIndices.length;
    }
    setCurrentMatchPosition(nextPos);

    const targetIndex = searchMatchIndices[nextPos];
    if (turns.some(t => t.index === targetIndex)) {
      setTimeout(() => scrollToMatch(nextPos), 0);
    } else {
      onLoadAroundTurn?.(targetIndex);
    }
  }, [searchMatchIndices, currentMatchPosition, turns, onLoadAroundTurn, scrollToMatch]);

  const dismissSearch = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    setShowSearch(false);
    setSearchText('');
    setActiveQuery('');
    setIsSearchScanning(false);
  }, []);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      dismissSearch();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      navigateSearch(false); // Enter goes upward (reverse search)
    }
  }, [dismissSearch, navigateSearch]);

  // Scroll to match when currentMatchPosition changes
  useEffect(() => {
    if (showSearch && searchMatchIndices.length > 0) {
      scrollToMatch(currentMatchPosition);
    }
  }, [currentMatchPosition, showSearch, searchMatchIndices.length, scrollToMatch]);

  // MARK: - Loading state

  if (isLoading) {
    return (
      <div
        data-testid="session-history-loading"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          gap: 8,
          color: 'var(--color-secondary, #8e8e93)',
        }}
      >
        <div className="spinner" style={{ width: 16, height: 16 }} />
        <span style={{ fontSize: 12 }}>Loading conversation...</span>
      </div>
    );
  }

  // MARK: - Empty state

  if (turns.length === 0) {
    return (
      <div
        data-testid="session-history-empty"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          gap: 8,
          color: 'var(--color-secondary, #8e8e93)',
        }}
      >
        <span style={{ fontSize: 18, opacity: 0.4 }}>&#x1F4AC;</span>
        <span style={{ fontSize: 12 }}>No conversation history</span>
      </div>
    );
  }

  // MARK: - Main content

  return (
    <div
      data-testid="session-history"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        backgroundColor: 'rgb(20, 20, 20)',
        overflow: 'hidden',
      }}
    >
      {/* Search overlay */}
      {showSearch && (
        <div
          data-testid="search-bar"
          style={{
            position: 'absolute',
            top: 6,
            left: 12,
            right: 12,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            backgroundColor: 'rgb(38, 38, 38)',
            borderRadius: 6,
          }}
        >
          <span style={{ fontSize: 12, opacity: 0.5, color: '#fff' }}>&#x1F50D;</span>
          <input
            ref={searchInputRef}
            data-testid="search-input"
            type="text"
            value={searchText}
            onChange={handleSearchTextChange}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search history..."
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              color: '#fff',
              fontSize: 12,
              fontFamily: 'monospace',
            }}
          />
          {activeQuery && (
            <>
              {isSearchScanning ? (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                  {searchMatchIndices.length > 0
                    ? `${searchMatchIndices.length} found...`
                    : 'Scanning...'}
                </span>
              ) : searchMatchIndices.length === 0 ? (
                <span data-testid="search-no-results" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                  0 results
                </span>
              ) : (
                <>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>
                    {searchMatchIndices.length - currentMatchPosition}/{searchMatchIndices.length}
                  </span>
                  <button
                    data-testid="search-prev"
                    onClick={() => navigateSearch(false)}
                    style={navButtonStyle}
                    aria-label="Previous match"
                  >
                    &#x25B2;
                  </button>
                  <button
                    data-testid="search-next"
                    onClick={() => navigateSearch(true)}
                    style={navButtonStyle}
                    aria-label="Next match"
                  >
                    &#x25BC;
                  </button>
                </>
              )}
            </>
          )}
          <button
            data-testid="search-close"
            onClick={dismissSearch}
            style={navButtonStyle}
            aria-label="Close search"
          >
            &#x2715;
          </button>
        </div>
      )}

      {/* Scrollable content */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 12px',
        }}
      >
        {/* Spacer for search bar */}
        {showSearch && <div style={{ height: 36 }} />}

        {/* Checkpoint banner */}
        {checkpointMode && (
          <div
            data-testid="checkpoint-banner"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: 8,
              backgroundColor: 'rgba(249, 115, 22, 0.15)',
              marginBottom: 8,
            }}
          >
            <span style={{ color: '#f97316' }}>&#x21BB;</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', flex: 1 }}>
              Click a turn to restore to. Everything after will be removed.
            </span>
            <button
              data-testid="cancel-checkpoint"
              onClick={onCancelCheckpoint}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.6)',
                cursor: 'pointer',
                fontSize: 12,
              }}
              aria-label="Cancel checkpoint mode"
            >
              &#x2715;
            </button>
          </div>
        )}

        {/* Loading more indicator */}
        {hasMoreTurns && isLoadingMore && (
          <div
            data-testid="loading-more"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '6px 0',
              color: 'rgba(255,255,255,0.5)',
              fontSize: 12,
            }}
          >
            <div className="spinner" style={{ width: 12, height: 12 }} />
            <span>Loading history...</span>
          </div>
        )}

        {/* Turn blocks */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 8 }}>
          {turns.map((turn) => (
            <TurnBlockView
              key={turn.lineNumber}
              id={`turn-${turn.index}`}
              turn={turn}
              checkpointMode={checkpointMode}
              isHovered={hoveredTurnIndex === turn.index}
              isDimmed={checkpointMode && hoveredTurnIndex !== null && turn.index > hoveredTurnIndex}
              highlightText={activeQuery || null}
              isCurrentMatch={currentMatchTurnIndex === turn.index}
              assistant={assistant}
              onHover={(hovering) => {
                if (checkpointMode) {
                  setHoveredTurnIndex(hovering ? turn.index : null);
                }
              }}
              onClick={() => {
                if (checkpointMode) onSelectTurn?.(turn);
              }}
            />
          ))}
          <div ref={bottomAnchorRef} style={{ height: 30 }} />
        </div>
      </div>
    </div>
  );
}

// MARK: - Turn Block View

interface TurnBlockViewProps {
  id: string;
  turn: ConversationTurn;
  checkpointMode: boolean;
  isHovered: boolean;
  isDimmed: boolean;
  highlightText: string | null;
  isCurrentMatch: boolean;
  assistant: CodingAssistant;
  onHover: (hovering: boolean) => void;
  onClick: () => void;
}

function TurnBlockView({
  id,
  turn,
  checkpointMode,
  isHovered,
  isDimmed,
  highlightText,
  isCurrentMatch,
  assistant,
  onHover,
  onClick,
}: TurnBlockViewProps): React.ReactElement {
  const isSearchMatch = useMemo(() => {
    if (!highlightText) return false;
    const q = highlightText.toLowerCase();
    return (
      turn.textPreview.toLowerCase().includes(q) ||
      turn.contentBlocks.some((b) => b.text.toLowerCase().includes(q))
    );
  }, [highlightText, turn]);

  const backgroundColor = useMemo(() => {
    if (isHovered && checkpointMode) return 'rgba(249, 115, 22, 0.1)';
    if (isCurrentMatch) return 'rgba(249, 115, 22, 0.12)';
    if (isSearchMatch) return 'rgba(234, 179, 8, 0.08)';
    if (turn.role === 'user') {
      const textBlocks = turn.contentBlocks.filter((b) => b.kind.type === 'text');
      if (textBlocks.length > 0) return 'rgb(38, 38, 38)';
    }
    return 'transparent';
  }, [isHovered, checkpointMode, isCurrentMatch, isSearchMatch, turn]);

  const borderStyle = useMemo(() => {
    if (isCurrentMatch) return '2px solid rgba(249, 115, 22, 0.7)';
    if (isSearchMatch) return '1px solid rgba(234, 179, 8, 0.3)';
    return 'none';
  }, [isCurrentMatch, isSearchMatch]);

  const promptSymbol = getHistoryPromptSymbol(assistant);

  return (
    <div
      id={id}
      data-testid={`turn-${turn.role}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        padding: '4px 6px',
        borderRadius: 4,
        opacity: isDimmed ? 0.3 : 1,
        backgroundColor,
        border: borderStyle,
        cursor: checkpointMode ? 'pointer' : 'default',
        transition: 'transform 0.15s ease-in-out',
        transform: isCurrentMatch ? 'scale(1.02)' : 'scale(1)',
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
    >
      {turn.role === 'user' ? (
        <UserTurnContent
          turn={turn}
          promptSymbol={promptSymbol}
          highlightText={highlightText}
          isCurrentMatch={isCurrentMatch}
        />
      ) : (
        <AssistantTurnContent
          turn={turn}
          highlightText={highlightText}
          isCurrentMatch={isCurrentMatch}
        />
      )}
    </div>
  );
}

// MARK: - User Turn Content

function UserTurnContent({
  turn,
  promptSymbol,
  highlightText,
  isCurrentMatch,
}: {
  turn: ConversationTurn;
  promptSymbol: string;
  highlightText: string | null;
  isCurrentMatch: boolean;
}): React.ReactElement {
  const textBlocks = turn.contentBlocks.filter((b) => b.kind.type === 'text');
  const toolResults = turn.contentBlocks.filter((b) => b.kind.type === 'toolResult');

  if (textBlocks.length > 0) {
    return (
      <>
        {textBlocks.map((block, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 0, fontFamily: 'monospace', fontSize: 12 }}>
            {i === 0 ? (
              <span style={{ color: '#22c55e', fontWeight: 'bold', whiteSpace: 'pre' }}>{promptSymbol} </span>
            ) : (
              <span style={{ whiteSpace: 'pre' }}>  </span>
            )}
            <HighlightedText text={block.text} query={highlightText} isCurrentMatch={isCurrentMatch} color="#fff" />
          </div>
        ))}
      </>
    );
  }

  if (toolResults.length > 0) {
    return (
      <>
        {toolResults.map((block, i) => (
          <ToolResultLine key={i} block={block} highlightText={highlightText} isCurrentMatch={isCurrentMatch} />
        ))}
      </>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, fontFamily: 'monospace', fontSize: 12 }}>
      <span style={{ color: '#22c55e', fontWeight: 'bold', whiteSpace: 'pre' }}>{promptSymbol} </span>
      <HighlightedText text={turn.textPreview} query={highlightText} isCurrentMatch={isCurrentMatch} color="#fff" />
    </div>
  );
}

// MARK: - Assistant Turn Content

function AssistantTurnContent({
  turn,
  highlightText,
  isCurrentMatch,
}: {
  turn: ConversationTurn;
  highlightText: string | null;
  isCurrentMatch: boolean;
}): React.ReactElement {
  if (turn.contentBlocks.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, fontFamily: 'monospace', fontSize: 12 }}>
        <span style={{ color: '#fff', whiteSpace: 'pre' }}>&#x25CF; </span>
        <HighlightedText text={turn.textPreview} query={highlightText} isCurrentMatch={isCurrentMatch} color="rgb(217, 217, 217)" />
      </div>
    );
  }

  let prevWasText = false;

  return (
    <>
      {turn.contentBlocks.map((block, i) => {
        const isFirst = i === 0 || !prevWasText;
        const isText = block.kind.type === 'text';
        prevWasText = isText;

        switch (block.kind.type) {
          case 'text':
            return (
              <TextBlockLine
                key={i}
                text={block.text}
                isFirst={isFirst}
                highlightText={highlightText}
                isCurrentMatch={isCurrentMatch}
              />
            );
          case 'toolUse':
            return (
              <ToolUseLine
                key={i}
                name={block.kind.name}
                displayText={block.text}
                highlightText={highlightText}
                isCurrentMatch={isCurrentMatch}
              />
            );
          case 'toolResult':
            return (
              <ToolResultLine key={i} block={block} highlightText={highlightText} isCurrentMatch={isCurrentMatch} />
            );
          case 'thinking':
            return (
              <ThinkingLine key={i} />
            );
          default:
            return null;
        }
      })}
    </>
  );
}

// MARK: - Line Components

function TextBlockLine({
  text,
  isFirst,
  highlightText,
  isCurrentMatch,
}: {
  text: string;
  isFirst: boolean;
  highlightText: string | null;
  isCurrentMatch: boolean;
}): React.ReactElement {
  const trimmed = text.trim();
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, fontFamily: 'monospace', fontSize: 12 }}>
      {isFirst ? (
        <span style={{ color: '#fff', whiteSpace: 'pre' }}>&#x25CF; </span>
      ) : (
        <span style={{ whiteSpace: 'pre' }}>  </span>
      )}
      <HighlightedText text={trimmed} query={highlightText} isCurrentMatch={isCurrentMatch} color="rgb(217, 217, 217)" />
    </div>
  );
}

function ToolUseLine({
  name,
  displayText,
  highlightText,
  isCurrentMatch,
}: {
  name: string;
  displayText: string;
  highlightText: string | null;
  isCurrentMatch: boolean;
}): React.ReactElement {
  const args = displayText !== name
    ? (displayText.startsWith(name) ? displayText.slice(name.length) : `(${displayText})`)
    : '';

  return (
    <div
      data-testid="tool-use-line"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 0, fontFamily: 'monospace', fontSize: 12 }}
    >
      <span style={{ color: '#22c55e', whiteSpace: 'pre' }}>  &#x25CF; </span>
      <HighlightedText text={name} query={highlightText} isCurrentMatch={isCurrentMatch} color="rgba(34, 197, 94, 0.8)" />
      {args && (
        <span title={args} style={{
          color: 'rgb(128, 128, 128)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '80%',
        }}>
          {args}
        </span>
      )}
    </div>
  );
}

function ToolResultLine({
  block,
  highlightText,
  isCurrentMatch,
}: {
  block: ContentBlock;
  highlightText: string | null;
  isCurrentMatch: boolean;
}): React.ReactElement {
  return (
    <div
      data-testid="tool-result-line"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0,
        fontFamily: 'monospace',
        fontSize: 12,
        overflow: 'hidden',
      }}
    >
      <span style={{ color: 'rgb(89, 89, 89)', whiteSpace: 'pre' }}>  &#x23BF; </span>
      <HighlightedText
        text={block.text}
        query={highlightText}
        isCurrentMatch={isCurrentMatch}
        color="rgb(89, 89, 89)"
        maxLines={3}
      />
    </div>
  );
}

function ThinkingLine(): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, fontFamily: 'monospace', fontSize: 12 }}>
      <span style={{ color: 'rgb(77, 77, 77)', whiteSpace: 'pre' }}>  &#x2234; </span>
      <span style={{ color: 'rgb(77, 77, 77)', fontStyle: 'italic' }}>Thinking...</span>
    </div>
  );
}

// MARK: - Highlighted Text

function HighlightedText({
  text,
  query,
  isCurrentMatch,
  color,
  maxLines,
}: {
  text: string;
  query: string | null;
  isCurrentMatch: boolean;
  color: string;
  maxLines?: number;
}): React.ReactElement {
  const style: React.CSSProperties = {
    color,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    ...(maxLines ? {
      overflow: 'hidden',
      display: '-webkit-box',
      WebkitLineClamp: maxLines,
      WebkitBoxOrient: 'vertical' as const,
    } : {}),
  };

  if (!query || query.length === 0) {
    return <span style={style}>{text}</span>;
  }

  const parts: React.ReactNode[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let lastIndex = 0;
  let pos = lowerText.indexOf(lowerQuery);
  let key = 0;

  while (pos !== -1) {
    if (pos > lastIndex) {
      parts.push(<span key={key++}>{text.slice(lastIndex, pos)}</span>);
    }
    parts.push(
      <mark
        key={key++}
        style={{
          backgroundColor: isCurrentMatch ? 'rgba(249, 115, 22, 0.5)' : 'rgba(234, 179, 8, 0.35)',
          color: isCurrentMatch ? '#f97316' : '#eab308',
          borderRadius: 2,
          padding: '0 1px',
        }}
      >
        {text.slice(pos, pos + query.length)}
      </mark>
    );
    lastIndex = pos + query.length;
    pos = lowerText.indexOf(lowerQuery, lastIndex);
  }

  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }

  return <span style={style}>{parts}</span>;
}

// MARK: - Style Constants

const navButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'rgba(255, 255, 255, 0.5)',
  cursor: 'pointer',
  fontSize: 10,
  padding: '2px 4px',
  lineHeight: 1,
};
