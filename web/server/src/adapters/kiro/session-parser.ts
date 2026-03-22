import type { ConversationTurn, ContentBlock } from '@kanban-code/shared';

/**
 * Parses Kiro CLI conversation JSON from SQLite.
 *
 * Kiro stores conversations in SQLite at ~/Library/Application Support/kiro-cli/data.sqlite3
 * in the conversations_v2 table. The `value` column contains JSON with this shape:
 *
 * {
 *   conversation_id: string,
 *   history: [{
 *     user: { content: { Prompt: { prompt: string } | ToolUseResults: [...] }, timestamp: string, images: [] },
 *     assistant: { Response: { message_id, content } | ToolUse: { tool_use_id, name, input } },
 *     request_metadata: { model_id: string }
 *   }]
 * }
 */

// MARK: - Raw Types (Kiro JSON shape)

export interface KiroPrompt {
  prompt: string;
}

export interface KiroToolUseResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface KiroToolUseResults {
  results: KiroToolUseResult[];
}

export type KiroUserContent =
  | { Prompt: KiroPrompt }
  | { ToolUseResults: KiroToolUseResults };

export interface KiroUserMessage {
  content: KiroUserContent;
  timestamp: string;
  images?: string[];
}

export interface KiroResponseContent {
  message_id: string;
  content: string;
}

export interface KiroToolUseContent {
  tool_use_id: string;
  name: string;
  input: Record<string, string>;
}

export type KiroAssistantMessage =
  | { Response: KiroResponseContent }
  | { ToolUse: KiroToolUseContent };

export interface KiroRequestMetadata {
  model_id?: string;
}

export interface KiroHistoryEntry {
  user: KiroUserMessage;
  assistant: KiroAssistantMessage;
  request_metadata?: KiroRequestMetadata;
}

export interface KiroConversation {
  conversation_id: string;
  history: KiroHistoryEntry[];
}

/** Metadata extracted from a Kiro conversation. */
export interface KiroSessionMetadata {
  sessionId: string;
  messageCount: number;
  firstPrompt?: string | null;
  modelId?: string | null;
}

// MARK: - Type Guards

function isPromptContent(content: KiroUserContent): content is { Prompt: KiroPrompt } {
  return 'Prompt' in content && content.Prompt != null;
}

function isToolUseResultsContent(content: KiroUserContent): content is { ToolUseResults: KiroToolUseResults } {
  return 'ToolUseResults' in content && content.ToolUseResults != null;
}

function isResponseMessage(msg: KiroAssistantMessage): msg is { Response: KiroResponseContent } {
  return 'Response' in msg && msg.Response != null;
}

function isToolUseMessage(msg: KiroAssistantMessage): msg is { ToolUse: KiroToolUseContent } {
  return 'ToolUse' in msg && msg.ToolUse != null;
}

// MARK: - Parsing

function parseConversation(raw: unknown): KiroConversation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const conversationId = obj.conversation_id;
  if (typeof conversationId !== 'string') return null;

  const history = obj.history;
  if (!Array.isArray(history)) return null;

  const entries: KiroHistoryEntry[] = [];
  for (const entry of history) {
    const parsed = parseHistoryEntry(entry);
    if (parsed) entries.push(parsed);
  }

  return { conversation_id: conversationId, history: entries };
}

function parseHistoryEntry(raw: unknown): KiroHistoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  if (!obj.user || typeof obj.user !== 'object') return null;
  if (!obj.assistant || typeof obj.assistant !== 'object') return null;

  const userMsg = parseUserMessage(obj.user);
  if (!userMsg) return null;

  const assistantMsg = parseAssistantMessage(obj.assistant);
  if (!assistantMsg) return null;

  let requestMetadata: KiroRequestMetadata | undefined;
  if (typeof obj.request_metadata === 'object' && obj.request_metadata !== null) {
    const meta = obj.request_metadata as Record<string, unknown>;
    requestMetadata = {
      model_id: typeof meta.model_id === 'string' ? meta.model_id : undefined,
    };
  }

  return { user: userMsg, assistant: assistantMsg, request_metadata: requestMetadata };
}

function parseUserMessage(raw: unknown): KiroUserMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const timestamp = typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString();

  let images: string[] | undefined;
  if (Array.isArray(obj.images)) {
    images = obj.images.filter((i): i is string => typeof i === 'string');
  }

  const content = obj.content;
  if (typeof content !== 'object' || content === null) return null;
  const contentObj = content as Record<string, unknown>;

  // Prompt variant
  if (contentObj.Prompt && typeof contentObj.Prompt === 'object') {
    const prompt = contentObj.Prompt as Record<string, unknown>;
    const promptText = typeof prompt.prompt === 'string' ? prompt.prompt : '';
    return {
      content: { Prompt: { prompt: promptText } },
      timestamp,
      images,
    };
  }

  // ToolUseResults variant
  if (contentObj.ToolUseResults && typeof contentObj.ToolUseResults === 'object') {
    const tur = contentObj.ToolUseResults as Record<string, unknown>;
    const results: KiroToolUseResult[] = [];
    if (Array.isArray(tur.results)) {
      for (const r of tur.results) {
        if (typeof r === 'object' && r !== null) {
          const rObj = r as Record<string, unknown>;
          results.push({
            tool_use_id: typeof rObj.tool_use_id === 'string' ? rObj.tool_use_id : '',
            content: typeof rObj.content === 'string' ? rObj.content : '',
            is_error: typeof rObj.is_error === 'boolean' ? rObj.is_error : undefined,
          });
        }
      }
    }
    return {
      content: { ToolUseResults: { results } },
      timestamp,
      images,
    };
  }

  return null;
}

function parseAssistantMessage(raw: unknown): KiroAssistantMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  // Response variant
  if (obj.Response && typeof obj.Response === 'object') {
    const resp = obj.Response as Record<string, unknown>;
    return {
      Response: {
        message_id: typeof resp.message_id === 'string' ? resp.message_id : '',
        content: typeof resp.content === 'string' ? resp.content : '',
      },
    };
  }

  // ToolUse variant
  if (obj.ToolUse && typeof obj.ToolUse === 'object') {
    const tu = obj.ToolUse as Record<string, unknown>;
    let input: Record<string, string> = {};
    if (typeof tu.input === 'object' && tu.input !== null && !Array.isArray(tu.input)) {
      const rawInput = tu.input as Record<string, unknown>;
      for (const [k, v] of Object.entries(rawInput)) {
        if (typeof v === 'string') {
          input[k] = v;
        }
      }
    }
    return {
      ToolUse: {
        tool_use_id: typeof tu.tool_use_id === 'string' ? tu.tool_use_id : '',
        name: typeof tu.name === 'string' ? tu.name : 'unknown',
        input,
      },
    };
  }

  return null;
}

// MARK: - Text Preview

function buildTextPreview(blocks: ContentBlock[], role: string): string {
  const textOnly = blocks
    .filter(b => b.kind.type === 'text')
    .map(b => b.text)
    .join('\n');

  if (textOnly.length > 0) {
    return textOnly.substring(0, 500);
  }

  if (blocks.length === 0) return '(empty)';

  if (role === 'user') {
    const resultCount = blocks.filter(b => b.kind.type === 'toolResult').length;
    if (resultCount > 0) {
      return `[tool result x${resultCount}]`;
    }
  } else {
    const toolNames = blocks
      .filter(b => b.kind.type === 'toolUse')
      .map(b => (b.kind as { type: 'toolUse'; name: string }).name);

    if (toolNames.length > 0) {
      const unique = [...new Set(toolNames)];
      return `[tool: ${unique.join(', ')}]`;
    }
  }

  return '(empty)';
}

// MARK: - Public API

export const KiroSessionParser = {
  /**
   * Parse raw JSON string into a KiroConversation.
   * @param json Raw JSON string from SQLite value column.
   * @returns Parsed conversation, or null if invalid.
   */
  parseConversation(json: string): KiroConversation | null {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return null;
    }
    return parseConversation(raw);
  },

  /**
   * Convert a Kiro conversation to ConversationTurn[].
   * Each history entry produces 2 turns (user + assistant).
   */
  toConversationTurns(conversation: KiroConversation): ConversationTurn[] {
    const turns: ConversationTurn[] = [];
    let turnIndex = 0;

    for (let i = 0; i < conversation.history.length; i++) {
      const entry = conversation.history[i];

      // User turn
      const userBlocks: ContentBlock[] = [];
      const userContent = entry.user.content;

      if (isPromptContent(userContent)) {
        if (userContent.Prompt.prompt.length > 0) {
          userBlocks.push({ kind: { type: 'text' }, text: userContent.Prompt.prompt });
        }
      } else if (isToolUseResultsContent(userContent)) {
        for (const result of userContent.ToolUseResults.results) {
          const toolName = result.tool_use_id || 'tool';
          userBlocks.push({
            kind: { type: 'toolResult', toolName },
            text: result.content,
          });
        }
      }

      turns.push({
        index: turnIndex,
        lineNumber: turnIndex + 1,
        role: 'user',
        textPreview: buildTextPreview(userBlocks, 'user'),
        timestamp: entry.user.timestamp ?? null,
        contentBlocks: userBlocks,
      });
      turnIndex++;

      // Assistant turn
      const assistantBlocks: ContentBlock[] = [];
      const assistantMsg = entry.assistant;

      if (isResponseMessage(assistantMsg)) {
        if (assistantMsg.Response.content.length > 0) {
          assistantBlocks.push({ kind: { type: 'text' }, text: assistantMsg.Response.content });
        }
      } else if (isToolUseMessage(assistantMsg)) {
        const tu = assistantMsg.ToolUse;
        assistantBlocks.push({
          kind: { type: 'toolUse', name: tu.name, input: tu.input },
          text: tu.name,
        });
      }

      turns.push({
        index: turnIndex,
        lineNumber: turnIndex + 1,
        role: 'assistant',
        textPreview: buildTextPreview(assistantBlocks, 'assistant'),
        timestamp: entry.user.timestamp ?? null,
        contentBlocks: assistantBlocks,
      });
      turnIndex++;
    }

    return turns;
  },

  /**
   * Extract metadata without parsing the full conversation.
   * @param json Raw JSON string from SQLite value column.
   * @returns Metadata or null if unparseable.
   */
  extractMetadata(json: string): KiroSessionMetadata | null {
    const conversation = KiroSessionParser.parseConversation(json);
    if (!conversation) return null;
    if (conversation.history.length === 0) return null;

    let firstPrompt: string | null = null;
    const firstEntry = conversation.history[0];
    if (isPromptContent(firstEntry.user.content)) {
      const text = firstEntry.user.content.Prompt.prompt;
      if (text.length > 0) {
        firstPrompt = text.length > 500 ? text.substring(0, 500) : text;
      }
    }

    let modelId: string | null = null;
    for (const entry of conversation.history) {
      if (entry.request_metadata?.model_id) {
        modelId = entry.request_metadata.model_id;
        break;
      }
    }

    return {
      sessionId: conversation.conversation_id,
      messageCount: conversation.history.length,
      firstPrompt,
      modelId,
    };
  },

  /**
   * Get the plain text from all user prompts in a conversation.
   * Used for full-text search indexing.
   */
  getFullText(conversation: KiroConversation): string {
    const parts: string[] = [];
    for (const entry of conversation.history) {
      if (isPromptContent(entry.user.content)) {
        parts.push(entry.user.content.Prompt.prompt);
      }
      if (isResponseMessage(entry.assistant)) {
        parts.push(entry.assistant.Response.content);
      }
    }
    return parts.join('\n');
  },
};
