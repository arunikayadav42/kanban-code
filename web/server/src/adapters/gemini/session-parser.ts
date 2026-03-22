import fs from 'fs';

/**
 * Parses Gemini CLI session JSON files.
 *
 * Gemini stores sessions at `~/.gemini/tmp/<project-slug>/chats/session-<timestamp>.json`.
 * Each file is a single JSON object with a `messages` array containing the conversation.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Gemini/GeminiSessionParser.swift
 */

// MARK: - Types

export interface ContentPart {
  text?: string | null;
}

export interface Thought {
  text?: string | null;
}

export interface TokenInfo {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}

/**
 * User content is `[{"text": "..."}]`, gemini/info/error content is a plain string.
 * This discriminated union handles both representations.
 */
export type MessageContent =
  | { type: 'text'; value: string }
  | { type: 'parts'; value: ContentPart[] };

export interface ToolCall {
  id?: string | null;
  name?: string | null;
  args?: Record<string, string> | null;
  result?: string | null;
  status?: string | null;
  timestamp?: string | null;
  displayName?: string | null;
  description?: string | null;
}

export interface Message {
  id?: string | null;
  type: string; // "user", "gemini", "info", "error"
  content: MessageContent;
  thoughts?: Thought[] | null;
  tokens?: TokenInfo | null;
  model?: string | null;
  toolCalls?: ToolCall[] | null;
  timestamp?: string | null;
}

export interface SessionFile {
  sessionId: string;
  projectHash?: string | null;
  startTime?: string | null;
  lastUpdated?: string | null;
  messages: Message[];
  summary?: string | null;
}

/** Metadata extracted from a Gemini session file. */
export interface SessionMetadata {
  sessionId: string;
  messageCount: number;
  firstPrompt?: string | null;
  summary?: string | null;
  projectPath?: string | null;
}

// MARK: - Parsing Helpers

/**
 * Parse raw content from JSON into a MessageContent.
 * Handles string (text) and array (parts) forms.
 */
function parseContent(raw: unknown): MessageContent {
  if (typeof raw === 'string') {
    return { type: 'text', value: raw };
  }
  if (Array.isArray(raw)) {
    const parts: ContentPart[] = raw.map((item: unknown) => {
      if (typeof item === 'object' && item !== null) {
        return { text: (item as Record<string, unknown>).text as string ?? null };
      }
      return { text: null };
    });
    return { type: 'parts', value: parts };
  }
  return { type: 'text', value: '' };
}

/**
 * Parse a tool call result which may be a string, an array of functionResponse
 * objects, or absent.
 */
function parseToolCallResult(raw: unknown): string | null {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw)) {
    const outputs: string[] = [];
    for (const item of raw) {
      if (typeof item === 'object' && item !== null) {
        const fr = (item as Record<string, unknown>).functionResponse;
        if (typeof fr === 'object' && fr !== null) {
          const response = (fr as Record<string, unknown>).response;
          if (typeof response === 'object' && response !== null) {
            const output = (response as Record<string, unknown>).output;
            if (typeof output === 'string') {
              outputs.push(output);
            }
          }
        }
      }
    }
    return outputs.length > 0 ? outputs.join('\n') : null;
  }
  return null;
}

/** Parse a single tool call from raw JSON. */
function parseToolCall(raw: unknown): ToolCall | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  let args: Record<string, string> | null = null;
  if (typeof obj.args === 'object' && obj.args !== null && !Array.isArray(obj.args)) {
    // Only include string values
    const rawArgs = obj.args as Record<string, unknown>;
    const stringArgs: Record<string, string> = {};
    let hasAny = false;
    for (const [k, v] of Object.entries(rawArgs)) {
      if (typeof v === 'string') {
        stringArgs[k] = v;
        hasAny = true;
      }
    }
    args = hasAny ? stringArgs : null;
  }

  return {
    id: typeof obj.id === 'string' ? obj.id : null,
    name: typeof obj.name === 'string' ? obj.name : null,
    args,
    result: parseToolCallResult(obj.result),
    status: typeof obj.status === 'string' ? obj.status : null,
    timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : null,
    displayName: typeof obj.displayName === 'string' ? obj.displayName : null,
    description: typeof obj.description === 'string' ? obj.description : null,
  };
}

/** Parse a message from raw JSON, with resilient handling. */
function parseMessage(raw: unknown): Message | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const type = obj.type;
  if (typeof type !== 'string') return null;

  const content = parseContent(obj.content);

  let thoughts: Thought[] | null = null;
  if (Array.isArray(obj.thoughts)) {
    thoughts = (obj.thoughts as unknown[])
      .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
      .map(t => ({ text: typeof t.text === 'string' ? t.text : null }));
  }

  let tokens: TokenInfo | null = null;
  if (typeof obj.tokens === 'object' && obj.tokens !== null) {
    const t = obj.tokens as Record<string, unknown>;
    tokens = {
      inputTokens: typeof t.inputTokens === 'number' ? t.inputTokens : null,
      outputTokens: typeof t.outputTokens === 'number' ? t.outputTokens : null,
      totalTokens: typeof t.totalTokens === 'number' ? t.totalTokens : null,
    };
  }

  let toolCalls: ToolCall[] | null = null;
  if (Array.isArray(obj.toolCalls)) {
    const parsed = (obj.toolCalls as unknown[])
      .map(parseToolCall)
      .filter((tc): tc is ToolCall => tc !== null);
    toolCalls = parsed.length > 0 ? parsed : null;
  }

  return {
    id: typeof obj.id === 'string' ? obj.id : null,
    type,
    content,
    thoughts,
    tokens,
    model: typeof obj.model === 'string' ? obj.model : null,
    toolCalls,
    timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : null,
  };
}

// MARK: - Parser

export const GeminiSessionParser = {
  /** Extract the combined text from a MessageContent, regardless of format. */
  getTextValue(content: MessageContent): string {
    if (content.type === 'text') {
      return content.value;
    }
    // parts
    return content.value
      .map(p => p.text)
      .filter((t): t is string => t != null)
      .join('\n');
  },

  /**
   * Parse the full session file.
   * @param filePath Absolute path to the session JSON file.
   * @returns The parsed session, or null if the file cannot be parsed.
   */
  parseSession(filePath: string): SessionFile | null {
    const data = fs.readFileSync(filePath, 'utf-8');
    const raw = JSON.parse(data);

    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;

    const sessionId = obj.sessionId;
    if (typeof sessionId !== 'string') return null;

    const rawMessages = obj.messages;
    if (!Array.isArray(rawMessages)) return null;

    const messages: Message[] = [];
    for (const rawMsg of rawMessages) {
      const msg = parseMessage(rawMsg);
      if (msg !== null) {
        messages.push(msg);
      } else {
        // Fallback: render as raw JSON text with type extracted if possible
        const type =
          typeof rawMsg === 'object' && rawMsg !== null
            ? (typeof (rawMsg as Record<string, unknown>).type === 'string'
              ? (rawMsg as Record<string, unknown>).type as string
              : 'unknown')
            : 'unknown';
        let rawText: string;
        try {
          rawText = JSON.stringify(rawMsg);
        } catch {
          rawText = '(unparseable message)';
        }
        messages.push({
          id: null,
          type,
          content: { type: 'text', value: rawText },
          thoughts: null,
          tokens: null,
          model: null,
          toolCalls: null,
          timestamp: null,
        });
      }
    }

    return {
      sessionId,
      projectHash: typeof obj.projectHash === 'string' ? obj.projectHash : null,
      startTime: typeof obj.startTime === 'string' ? obj.startTime : null,
      lastUpdated: typeof obj.lastUpdated === 'string' ? obj.lastUpdated : null,
      messages,
      summary: typeof obj.summary === 'string' ? obj.summary : null,
    };
  },

  /**
   * Parse a session JSON file and extract metadata.
   * @param filePath Absolute path to the session JSON file.
   * @returns Extracted metadata, or null if the file cannot be parsed or has no user/gemini messages.
   */
  extractMetadata(filePath: string): SessionMetadata | null {
    const data = fs.readFileSync(filePath, 'utf-8');
    const raw = JSON.parse(data);

    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;

    const sessionId = obj.sessionId;
    if (typeof sessionId !== 'string') return null;

    const rawMessages = obj.messages;
    if (!Array.isArray(rawMessages)) return null;

    // Parse messages and filter to user + gemini
    const messages: Message[] = [];
    for (const rawMsg of rawMessages) {
      const msg = parseMessage(rawMsg);
      if (msg) messages.push(msg);
    }

    const userAndGemini = messages.filter(m => m.type === 'user' || m.type === 'gemini');
    if (userAndGemini.length === 0) return null;

    const firstUserMessage = messages.find(m => m.type === 'user');
    let firstPrompt: string | null = null;
    if (firstUserMessage) {
      const text = GeminiSessionParser.getTextValue(firstUserMessage.content);
      if (text.length > 0) {
        firstPrompt = text.length > 500 ? text.substring(0, 500) : text;
      }
    }

    return {
      sessionId,
      messageCount: userAndGemini.length,
      firstPrompt,
      summary: typeof obj.summary === 'string' ? obj.summary : null,
      projectPath: null, // Resolved externally from projects.json slug mapping
    };
  },
};
