/**
 * Reads conversation turns from a .jsonl transcript file.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/ClaudeCode/TranscriptReader.swift
 */

import * as fs from 'fs';
import * as readline from 'readline';
import type { ContentBlock, ContentBlockKind, ConversationTurn } from '@kanban-code/shared';
import { JsonlParser } from './jsonl-parser.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a paginated read: turns + whether more exist before these. */
export interface ReadResult {
  turns: ConversationTurn[];
  totalLineCount: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Helper: create readline interface from file path
// ---------------------------------------------------------------------------

function createLineReader(filePath: string): { rl: readline.Interface; stream: fs.ReadStream } {
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  return { rl, stream };
}

// ---------------------------------------------------------------------------
// TranscriptReader
// ---------------------------------------------------------------------------

export class TranscriptReader {

  /** Read all conversation turns from a .jsonl file (legacy -- use readTail for large files). */
  static async readTurns(filePath: string): Promise<ConversationTurn[]> {
    const result = await TranscriptReader.readTail(filePath, Number.MAX_SAFE_INTEGER);
    return result.turns;
  }

  /** Read the last `maxTurns` conversation turns from a .jsonl file.
   *  Reads the file efficiently: scans all lines but only parses the last N turns fully. */
  static async readTail(filePath: string, maxTurns: number = 80): Promise<ReadResult> {
    if (!fs.existsSync(filePath)) {
      return { turns: [], totalLineCount: 0, hasMore: false };
    }

    const { rl, stream } = createLineReader(filePath);

    // First pass: count turns and record line info for the last N
    let turnLineInfos: Array<{ lineNumber: number; line: string }> = [];
    let lineNumber = 0;
    let totalTurnCount = 0;

    try {
      for await (const line of rl) {
        lineNumber += 1;
        if (!line || !line.includes('"type"')) continue;

        // Quick check: is this a user/assistant line?
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }

        const type = obj.type as string | undefined;
        if (type !== 'user' && type !== 'assistant') continue;

        // Skip caveat wrapper messages entirely
        if (type === 'user' && JsonlParser.isCaveatMessage(obj)) continue;

        totalTurnCount += 1;
        turnLineInfos.push({ lineNumber, line });
        // Keep only the last maxTurns entries in the ring
        if (turnLineInfos.length > maxTurns) {
          turnLineInfos.shift();
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    // Second pass: parse only the turns we're keeping
    const startIndex = totalTurnCount - turnLineInfos.length;
    const turns: ConversationTurn[] = [];

    for (let i = 0; i < turnLineInfos.length; i++) {
      const info = turnLineInfos[i];
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(info.line);
      } catch {
        continue;
      }

      const type = obj.type as string;

      // Stdout responses display as assistant-style turns
      const role = (type === 'user' && JsonlParser.isLocalCommandStdout(obj)) ? 'assistant' : type;

      let blocks: ContentBlock[];
      let textPreview: string;

      if (type === 'user') {
        blocks = extractUserBlocks(obj);
        textPreview = TranscriptReader.buildTextPreview(blocks, role);
      } else {
        blocks = extractAssistantBlocks(obj);
        textPreview = TranscriptReader.buildTextPreview(blocks, role);
      }

      const timestamp = typeof obj.timestamp === 'string' ? obj.timestamp : null;

      turns.push({
        index: startIndex + i,
        lineNumber: info.lineNumber,
        role,
        textPreview,
        timestamp,
        contentBlocks: blocks,
      });
    }

    return {
      turns,
      totalLineCount: lineNumber,
      hasMore: totalTurnCount > turnLineInfos.length,
    };
  }

  /** Load turns within a specific turn index range (for "load more" pagination).
   *  rangeStart is inclusive, rangeEnd is exclusive. */
  static async readRange(
    filePath: string,
    rangeStart: number,
    rangeEnd: number,
  ): Promise<ConversationTurn[]> {
    if (!fs.existsSync(filePath)) return [];

    const { rl, stream } = createLineReader(filePath);

    const turns: ConversationTurn[] = [];
    let lineNumber = 0;
    let turnIndex = 0;

    try {
      for await (const line of rl) {
        lineNumber += 1;
        if (!line || !line.includes('"type"')) continue;

        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }

        const type = obj.type as string | undefined;
        if (type !== 'user' && type !== 'assistant') continue;

        // Skip caveat wrapper messages entirely
        if (type === 'user' && JsonlParser.isCaveatMessage(obj)) continue;

        // Stdout responses display as assistant-style turns
        const role = (type === 'user' && JsonlParser.isLocalCommandStdout(obj)) ? 'assistant' : type;

        const currentTurnIndex = turnIndex;
        turnIndex += 1;

        // Skip turns outside our range
        if (currentTurnIndex < rangeStart) continue;
        if (currentTurnIndex >= rangeEnd) break;

        let blocks: ContentBlock[];
        let textPreview: string;

        if (type === 'user') {
          blocks = extractUserBlocks(obj);
          textPreview = TranscriptReader.buildTextPreview(blocks, role);
        } else {
          blocks = extractAssistantBlocks(obj);
          textPreview = TranscriptReader.buildTextPreview(blocks, role);
        }

        const timestamp = typeof obj.timestamp === 'string' ? obj.timestamp : null;

        turns.push({
          index: currentTurnIndex,
          lineNumber,
          role,
          textPreview,
          timestamp,
          contentBlocks: blocks,
        });
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    return turns;
  }

  // -----------------------------------------------------------------------
  // Preview text
  // -----------------------------------------------------------------------

  /** Build a descriptive text preview for a conversation turn. */
  static buildTextPreview(blocks: ContentBlock[], role: string): string {
    const textOnly = blocks
      .filter((b) => b.kind.type === 'text')
      .map((b) => b.text)
      .join('\n');

    if (textOnly.length > 0) {
      return textOnly.substring(0, 500);
    }

    if (blocks.length === 0) return '(empty)';

    if (role === 'user') {
      // User messages with tool_result blocks
      const resultCount = blocks.filter((b) => b.kind.type === 'toolResult').length;
      if (resultCount > 0) {
        return `[tool result x${resultCount}]`;
      }
    } else {
      // Assistant messages with tool_use blocks -- list tool names
      const toolNames = blocks
        .filter((b): b is ContentBlock & { kind: { type: 'toolUse'; name: string } } => b.kind.type === 'toolUse')
        .map((b) => (b.kind as { type: 'toolUse'; name: string }).name);
      if (toolNames.length > 0) {
        // Deduplicate while preserving order
        const unique = [...new Set(toolNames)];
        return `[tool: ${unique.join(', ')}]`;
      }
    }

    return '(empty)';
  }

  /** Shorten a file path for display -- keep last 2-3 components. */
  static shortenPath(filePath: string): string {
    const components = filePath.split('/').filter((c) => c.length > 0);
    if (components.length <= 3) return filePath;
    return '.../' + components.slice(-3).join('/');
  }
}

// ---------------------------------------------------------------------------
// User message parsing
// ---------------------------------------------------------------------------

function extractUserBlocks(obj: Record<string, unknown>): ContentBlock[] {
  // Hide caveat wrapper messages entirely
  if (JsonlParser.isCaveatMessage(obj)) return [];

  // User text can be at top level or inside message.content
  const text = JsonlParser.extractTextContent(obj);
  if (text !== null) {
    // Show slash commands cleanly (e.g. "/clear")
    const command = JsonlParser.parseLocalCommand(text);
    if (command) {
      return [{ kind: { type: 'text' }, text: command }];
    }
    // Show command stdout as plain text
    const stdout = JsonlParser.parseLocalCommandStdout(text);
    if (stdout) {
      return [{ kind: { type: 'text' }, text: stdout }];
    }
    // Strip any remaining metadata tags from mixed-content messages
    const cleaned = JsonlParser.stripMetadataTags(text).trim();
    if (cleaned.length > 0) {
      return [{ kind: { type: 'text' }, text: cleaned }];
    }
    return [];
  }

  // Check for tool_result blocks in message.content
  const message = obj.message as Record<string, unknown> | undefined;
  if (!message) return [];
  const content = message.content;
  if (!Array.isArray(content)) return [];

  const blocks: ContentBlock[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    const blockType = block.type as string | undefined;
    if (!blockType) continue;

    switch (blockType) {
      case 'text': {
        const text = block.text as string | undefined;
        if (text && text.length > 0) {
          blocks.push({ kind: { type: 'text' }, text });
        }
        break;
      }
      case 'tool_result': {
        let resultText: string;
        const resultContent = block.content;
        if (typeof resultContent === 'string') {
          const lines = resultContent.split('\n');
          resultText = lines.length > 1 ? `Result (${lines.length} lines)` : resultContent.substring(0, 200);
        } else {
          resultText = 'Result';
        }
        blocks.push({ kind: { type: 'toolResult', toolName: null }, text: resultText });
        break;
      }
      default:
        break;
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Assistant message parsing
// ---------------------------------------------------------------------------

function extractAssistantBlocks(obj: Record<string, unknown>): ContentBlock[] {
  const message = obj.message as Record<string, unknown> | undefined;
  if (!message) return [];

  const content = message.content;
  if (!content) return [];

  // Simple string content
  if (typeof content === 'string') {
    return content.length === 0 ? [] : [{ kind: { type: 'text' }, text: content }];
  }

  // Array of content blocks
  if (!Array.isArray(content)) return [];

  const result: ContentBlock[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    const blockType = block.type as string | undefined;
    if (!blockType) continue;

    switch (blockType) {
      case 'text': {
        const text = block.text as string | undefined;
        if (text && text.length > 0) {
          result.push({ kind: { type: 'text' }, text });
        }
        break;
      }
      case 'tool_use': {
        result.push(parseToolUse(block));
        break;
      }
      case 'thinking': {
        const thinking = block.thinking as string | undefined;
        if (thinking && thinking.length > 0) {
          result.push({ kind: { type: 'thinking' }, text: thinking.substring(0, 500) });
        }
        break;
      }
      default:
        break;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tool use parsing
// ---------------------------------------------------------------------------

function parseToolUse(block: Record<string, unknown>): ContentBlock {
  const name = (block.name as string) ?? 'unknown';
  const input = (block.input as Record<string, unknown>) ?? {};

  const { displayText, inputMap } = extractToolInfo(name, input);

  return {
    kind: { type: 'toolUse', name, input: inputMap },
    text: displayText,
  };
}

/** Extract display text and key input fields for each tool type. */
function extractToolInfo(
  name: string,
  input: Record<string, unknown>,
): { displayText: string; inputMap: Record<string, string> } {
  const inputMap: Record<string, string> = {};

  switch (name) {
    case 'Bash': {
      const command = (input.command as string) ?? '';
      const desc = input.description as string | undefined;
      inputMap.command = command;
      if (desc) inputMap.description = desc;
      const display = desc ?? command.substring(0, 200);
      return { displayText: `${name}(${display})`, inputMap };
    }
    case 'Read': {
      const filePath = (input.file_path as string) ?? '';
      inputMap.file_path = filePath;
      return { displayText: `${name}(${TranscriptReader.shortenPath(filePath)})`, inputMap };
    }
    case 'Write': {
      const filePath = (input.file_path as string) ?? '';
      inputMap.file_path = filePath;
      return { displayText: `${name}(${TranscriptReader.shortenPath(filePath)})`, inputMap };
    }
    case 'Edit': {
      const filePath = (input.file_path as string) ?? '';
      inputMap.file_path = filePath;
      return { displayText: `${name}(${TranscriptReader.shortenPath(filePath)})`, inputMap };
    }
    case 'Grep': {
      const pattern = (input.pattern as string) ?? '';
      const pathStr = input.path as string | undefined;
      inputMap.pattern = pattern;
      if (pathStr) inputMap.path = pathStr;
      const pathPart = pathStr ? ` in ${TranscriptReader.shortenPath(pathStr)}` : '';
      return { displayText: `${name}("${pattern}"${pathPart})`, inputMap };
    }
    case 'Glob': {
      const pattern = (input.pattern as string) ?? '';
      inputMap.pattern = pattern;
      return { displayText: `${name}(${pattern})`, inputMap };
    }
    case 'Agent': {
      const prompt = (input.prompt as string) ?? '';
      const desc = (input.description as string) ?? prompt.substring(0, 80);
      inputMap.prompt = prompt.substring(0, 200);
      return { displayText: `${name}(${desc})`, inputMap };
    }
    case 'Skill': {
      const skill = (input.skill as string) ?? '';
      inputMap.skill = skill;
      return { displayText: `${name}(${skill})`, inputMap };
    }
    case 'TaskCreate': {
      const subject = (input.subject as string) ?? '';
      inputMap.subject = subject;
      return { displayText: `${name}(${subject})`, inputMap };
    }
    case 'TaskUpdate': {
      const taskId = (input.taskId as string) ?? '';
      const status = input.status as string | undefined;
      inputMap.taskId = taskId;
      if (status) inputMap.status = status;
      const detail = status ? `${taskId}: ${status}` : taskId;
      return { displayText: `${name}(${detail})`, inputMap };
    }
    default:
      return { displayText: name, inputMap };
  }
}
