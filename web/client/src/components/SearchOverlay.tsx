import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Link, KanbanCodeColumn } from '@kanban-code/shared';
import { getApiBase } from '../lib/api-client.js';

/**
 * Command palette / search overlay.
 *
 * Swift source: Sources/KanbanCode/SearchOverlay.swift
 *
 * Three modes:
 * 1. Empty query: recent cards sorted by lastOpenedAt
 * 2. Typed query: live filter (substring match on card fields)
 * 3. Enter key: deep search via NDJSON streaming from /api/search
 *
 * ">" prefix = command mode (Open Settings, Toggle View, New Task, project switching)
 * Arrow keys navigate, Enter selects + focuses terminal, Escape closes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandItem {
  id: string;
  title: string;
  icon: string;
  shortcut?: string;
  action: () => void;
}

export interface SearchResult {
  sessionPath: string;
  score: number;
  snippets: string[];
  cardId: string | null;
}

export interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  cards: Link[];
  commands?: CommandItem[];
  initialQuery?: string;
  onSelectCard?: (card: Link) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SearchOverlay({
  isOpen,
  onClose,
  cards,
  commands = [],
  initialQuery = '',
  onSelectCard,
}: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isDeepSearching, setIsDeepSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset state on open/close
  useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery);
      setSearchResults([]);
      setIsDeepSearching(false);
      // Focus input after render
      requestAnimationFrame(() => inputRef.current?.focus());
      // Pre-select second recent card (skip focused card)
      const sorted = recentSortedCards;
      if (initialQuery === '' && sorted.length >= 2) {
        setSelectedId(sorted[1].id);
      } else {
        setSelectedId(null);
      }
    } else {
      // Cancel any in-flight search
      abortRef.current?.abort();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const isCommandMode = query.startsWith('>');

  const commandQuery = useMemo(() => {
    if (!isCommandMode) return '';
    return query.slice(1).trim().toLowerCase();
  }, [query, isCommandMode]);

  const filteredCommands = useMemo(() => {
    if (!commandQuery) return commands;
    return commands.filter((c) => c.title.toLowerCase().includes(commandQuery));
  }, [commands, commandQuery]);

  const recentSortedCards = useMemo(() => {
    return [...cards].sort((a, b) => {
      const ta = String(a.lastOpenedAt ?? a.lastActivity ?? a.updatedAt ?? '');
      const tb = String(b.lastOpenedAt ?? b.lastActivity ?? b.updatedAt ?? '');
      return tb.localeCompare(ta);
    });
  }, [cards]);

  const queryTerms = useMemo(() => {
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
  }, [query]);

  const filteredCards = useMemo(() => {
    if (!query || isCommandMode) return [];
    return computeFilteredCards(cards, queryTerms);
  }, [cards, query, queryTerms, isCommandMode]);

  // Visible item IDs for keyboard navigation
  const visibleIds = useMemo((): string[] => {
    if (isCommandMode) return filteredCommands.map((c) => c.id);
    if (query === '') return recentSortedCards.slice(0, 20).map((c) => c.id);
    if (searchResults.length > 0) return searchResults.map((r) => r.sessionPath);
    return filteredCards.map((c) => c.id);
  }, [isCommandMode, filteredCommands, query, recentSortedCards, searchResults, filteredCards]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleQueryChange = useCallback(
    (newValue: string) => {
      setQuery(newValue);
      // Cancel any in-progress deep search
      abortRef.current?.abort();
      setSearchResults([]);
      setIsDeepSearching(false);

      if (newValue.startsWith('>')) {
        setSelectedId(null);
      } else if (newValue === '') {
        const sorted = [...cards].sort((a, b) => {
          const ta = a.lastOpenedAt ?? a.lastActivity ?? a.updatedAt ?? '';
          const tb = b.lastOpenedAt ?? b.lastActivity ?? b.updatedAt ?? '';
          return tb.localeCompare(ta);
        });
        setSelectedId(sorted.length >= 2 ? sorted[1].id : sorted[0]?.id ?? null);
      } else {
        const terms = newValue
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 0);
        const filtered = computeFilteredCards(cards, terms);
        setSelectedId(filtered[0]?.id ?? null);
      }
    },
    [cards],
  );

  const deepSearch = useCallback(async () => {
    if (!query.trim() || isCommandMode) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsDeepSearching(true);
    setSearchResults([]);

    try {
      const res = await fetch(`${getApiBase()}/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setIsDeepSearching(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const results: SearchResult[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const result = JSON.parse(line) as SearchResult;
            // Dedupe by sessionPath (streaming sends progressive updates)
            const idx = results.findIndex((r) => r.sessionPath === result.sessionPath);
            if (idx >= 0) {
              results[idx] = result;
            } else {
              results.push(result);
            }
          } catch {
            // Skip malformed lines
          }
        }

        // Sort by score and update state
        results.sort((a, b) => b.score - a.score);
        setSearchResults([...results]);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        // Silently ignore other errors
      }
    } finally {
      setIsDeepSearching(false);
    }
  }, [query, isCommandMode]);

  const moveSelection = useCallback(
    (offset: number) => {
      const ids = visibleIds;
      if (ids.length === 0) return;

      if (selectedId) {
        const currentIdx = ids.indexOf(selectedId);
        if (currentIdx >= 0) {
          const newIdx = currentIdx + offset;
          if (newIdx < 0) {
            setSelectedId(null); // Deselect above first
          } else {
            setSelectedId(ids[Math.min(newIdx, ids.length - 1)]);
          }
        } else {
          setSelectedId(offset > 0 ? ids[0] : ids[ids.length - 1]);
        }
      } else {
        setSelectedId(offset > 0 ? ids[0] : ids[ids.length - 1]);
      }
    },
    [visibleIds, selectedId],
  );

  const selectCurrentItem = useCallback(() => {
    if (!selectedId) {
      deepSearch();
      return;
    }

    if (isCommandMode) {
      const cmd = filteredCommands.find((c) => c.id === selectedId);
      if (cmd) {
        cmd.action();
        onClose();
      }
      return;
    }

    // Search results mode
    if (searchResults.length > 0) {
      const result = searchResults.find((r) => r.sessionPath === selectedId);
      if (result?.cardId) {
        const card = cards.find((c) => c.id === result.cardId);
        if (card) {
          onSelectCard?.(card);
          onClose();
        }
      }
      return;
    }

    // Card selection (recent or filtered)
    const allVisible = query === '' ? recentSortedCards.slice(0, 20) : filteredCards;
    const card = allVisible.find((c) => c.id === selectedId);
    if (card) {
      onSelectCard?.(card);
      onClose();
    } else {
      deepSearch();
    }
  }, [
    selectedId,
    isCommandMode,
    filteredCommands,
    searchResults,
    cards,
    query,
    recentSortedCards,
    filteredCards,
    onSelectCard,
    onClose,
    deepSearch,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveSelection(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveSelection(-1);
          break;
        case 'Enter':
          e.preventDefault();
          selectCurrentItem();
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [moveSelection, selectCurrentItem, onClose],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!isOpen) return null;

  return (
    <div
      data-testid="search-overlay"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-[600px] max-h-[500px] bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Search field bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            data-testid="search-input"
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search or type > for commands..."
            className="flex-1 bg-transparent outline-none text-base"
          />
          {isDeepSearching && (
            <span data-testid="search-spinner" className="text-xs text-gray-400">
              Searching...
            </span>
          )}
          {query && !isCommandMode && (
            <span className="text-xs text-gray-400">Enter: deep search</span>
          )}
          <button
            data-testid="search-close"
            onClick={onClose}
            className="px-2 py-0.5 text-xs border rounded border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Esc
          </button>
        </div>

        {/* Results section */}
        <div className="flex-1 overflow-y-auto p-2" data-testid="search-results">
          {isCommandMode ? (
            <CommandsSection
              commands={filteredCommands}
              selectedId={selectedId}
              onSelect={(cmd) => {
                cmd.action();
                onClose();
              }}
            />
          ) : query === '' ? (
            <RecentCardsSection
              cards={recentSortedCards.slice(0, 20)}
              selectedId={selectedId}
              onSelect={(card) => {
                onSelectCard?.(card);
                onClose();
              }}
            />
          ) : searchResults.length > 0 ? (
            <DeepSearchResultsSection
              results={searchResults}
              cards={cards}
              selectedId={selectedId}
              queryTerms={queryTerms}
              onSelect={(card) => {
                onSelectCard?.(card);
                onClose();
              }}
            />
          ) : (
            <FilteredCardsSection
              cards={filteredCards}
              selectedId={selectedId}
              queryTerms={queryTerms}
              onSelect={(card) => {
                onSelectCard?.(card);
                onClose();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function CommandsSection({
  commands,
  selectedId,
  onSelect,
}: {
  commands: CommandItem[];
  selectedId: string | null;
  onSelect: (cmd: CommandItem) => void;
}) {
  return (
    <>
      <div className="text-xs text-gray-400 px-2 py-1">Commands</div>
      {commands.length === 0 ? (
        <div data-testid="no-commands" className="text-sm text-gray-400 text-center py-4">
          No matching commands
        </div>
      ) : (
        commands.map((cmd) => (
          <div
            key={cmd.id}
            data-testid={`command-${cmd.id}`}
            className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer ${
              cmd.id === selectedId ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
            onClick={() => onSelect(cmd)}
          >
            <span className="text-gray-400 w-5 text-center">{cmd.icon}</span>
            <span className="flex-1 text-sm">{cmd.title}</span>
            {cmd.shortcut && (
              <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                {cmd.shortcut}
              </span>
            )}
          </div>
        ))
      )}
    </>
  );
}

function RecentCardsSection({
  cards,
  selectedId,
  onSelect,
}: {
  cards: Link[];
  selectedId: string | null;
  onSelect: (card: Link) => void;
}) {
  return (
    <>
      <div className="text-xs text-gray-400 px-2 py-1">Recent</div>
      {cards.map((card) => (
        <CardRow
          key={card.id}
          card={card}
          isHighlighted={card.id === selectedId}
          queryTerms={[]}
          onClick={() => onSelect(card)}
        />
      ))}
    </>
  );
}

function DeepSearchResultsSection({
  results,
  cards,
  selectedId,
  queryTerms,
  onSelect,
}: {
  results: SearchResult[];
  cards: Link[];
  selectedId: string | null;
  queryTerms: string[];
  onSelect: (card: Link) => void;
}) {
  const maxScore = results[0]?.score ?? 1;

  return (
    <>
      {results.map((result) => {
        const card = result.cardId ? cards.find((c) => c.id === result.cardId) : undefined;
        const ratio = maxScore > 0 ? result.score / maxScore : 0;

        return (
          <div
            key={result.sessionPath}
            data-testid={`search-result-${result.sessionPath}`}
            className={`flex items-start gap-2 px-3 py-2 rounded cursor-pointer ${
              result.sessionPath === selectedId
                ? 'bg-blue-50 dark:bg-blue-900/20'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
            onClick={() => {
              if (card) onSelect(card);
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate" title={card ? displayTitle(card) : result.sessionPath.split('/').pop()}>
                {card ? displayTitle(card) : result.sessionPath.split('/').pop()}
              </div>
              {result.snippets.slice(0, 3).map((snippet, i) => (
                <div key={i} className="text-xs text-gray-400 truncate mt-0.5" title={snippet}>
                  {snippet}
                </div>
              ))}
            </div>
            {/* Relevance bar */}
            <div className="w-12 h-3 bg-gray-100 dark:bg-gray-800 rounded-sm overflow-hidden flex-shrink-0 mt-1">
              <div
                className="h-full bg-blue-400 dark:bg-blue-600 rounded-sm"
                style={{ width: `${ratio * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}

function FilteredCardsSection({
  cards,
  selectedId,
  queryTerms,
  onSelect,
}: {
  cards: Link[];
  selectedId: string | null;
  queryTerms: string[];
  onSelect: (card: Link) => void;
}) {
  if (cards.length === 0) {
    return (
      <div data-testid="no-matches" className="text-center py-6">
        <div className="text-sm text-gray-400">No matches</div>
        <div className="text-xs text-gray-400 mt-1">Press Enter to deep search .jsonl files</div>
      </div>
    );
  }

  return (
    <>
      {cards.map((card) => (
        <CardRow
          key={card.id}
          card={card}
          isHighlighted={card.id === selectedId}
          queryTerms={queryTerms}
          onClick={() => onSelect(card)}
        />
      ))}
    </>
  );
}

function CardRow({
  card,
  isHighlighted,
  queryTerms,
  onClick,
}: {
  card: Link;
  isHighlighted: boolean;
  queryTerms: string[];
  onClick: () => void;
}) {
  const title = displayTitle(card);
  const project = card.projectPath?.split('/').pop() ?? '';

  return (
    <div
      data-testid={`card-row-${card.id}`}
      className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer ${
        isHighlighted ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
      }`}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate" title={title}>{title}</div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          {project && <span>{project}</span>}
          {card.worktreeLink?.branch && <span>{card.worktreeLink.branch}</span>}
        </div>
      </div>
      <span className="text-xs text-gray-400 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full whitespace-nowrap">
        {columnLabel(card.column)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function displayTitle(link: Link): string {
  return link.name ?? link.promptBody ?? link.worktreeLink?.branch ?? link.id;
}

function columnLabel(column: KanbanCodeColumn): string {
  switch (column) {
    case 'backlog':
      return 'Backlog';
    case 'in_progress':
      return 'In Progress';
    case 'requires_attention':
      return 'Waiting';
    case 'in_review':
      return 'In Review';
    case 'done':
      return 'Done';
    case 'all_sessions':
      return 'All Sessions';
    default:
      return column;
  }
}

/**
 * Compute filtered cards matching query terms.
 * Ports Swift SearchOverlay.computeFilteredCards logic.
 */
function computeFilteredCards(cards: Link[], terms: string[]): Link[] {
  if (terms.length === 0) return [];

  const activeColumns = new Set<KanbanCodeColumn>(['in_progress', 'requires_attention', 'in_review', 'done']);

  const scored = cards
    .map((card) => {
      const title = displayTitle(card).toLowerCase();
      const project = (card.projectPath?.split('/').pop() ?? '').toLowerCase();
      const branch = (card.worktreeLink?.branch ?? '').toLowerCase();
      const other = [
        card.projectPath ?? '',
        card.promptBody ?? '',
        card.sessionLink?.sessionId ?? '',
        card.id,
      ]
        .join(' ')
        .toLowerCase();

      const titleWords = title.split(/[^a-z0-9]+/).filter(Boolean);
      const projectWords = project.split(/[^a-z0-9]+/).filter(Boolean);

      let score = 0;
      for (const term of terms) {
        const s = termScore(term, titleWords, title, projectWords, project, branch, other);
        if (s > 0) {
          score += s;
        } else if (term.length >= 2 && fuzzyInitials(term, titleWords)) {
          score += 10;
        } else {
          return null; // All terms must match
        }
      }

      if (activeColumns.has(card.column)) score += 20;

      // Recency bonus (up to +5 within 7 days)
      const lastActive = card.lastActivity ?? card.updatedAt;
      if (lastActive) {
        const ageMs = Date.now() - new Date(lastActive).getTime();
        const maxAgeMs = 7 * 24 * 3600 * 1000;
        if (ageMs < maxAgeMs) {
          score += 5.0 * (1.0 - ageMs / maxAgeMs);
        }
      }

      return { card, score };
    })
    .filter((r): r is { card: Link; score: number } => r !== null);

  scored.sort((a, b) => b.score - a.score);
  return scored.map((r) => r.card);
}

function termScore(
  term: string,
  titleWords: string[],
  title: string,
  projectWords: string[],
  project: string,
  branch: string,
  other: string,
): number {
  for (const word of titleWords) {
    if (word === term) return 15;
    if (word.startsWith(term)) return 12;
  }
  if (title.includes(term)) return 6;

  for (const word of projectWords) {
    if (word === term) return 8;
    if (word.startsWith(term)) return 7;
  }
  if (project.includes(term)) return 4;

  if (branch.includes(term)) return 3;
  if (other.includes(term)) return 1;
  return 0;
}

function fuzzyInitials(term: string, words: string[]): boolean {
  let i = 0;
  for (const word of words) {
    if (i >= term.length) break;
    if (word.length > 0 && word[0] === term[i]) {
      i++;
    }
  }
  return i === term.length;
}
