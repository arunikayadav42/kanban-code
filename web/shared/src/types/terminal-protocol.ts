/** Server → Client JSON messages (sent via WebSocket text frames). */
export type TerminalServerMessage =
  | { type: 'exit'; code: number | undefined; signal: number | undefined }
  | { type: 'error'; message: string };

/** Client → Server JSON messages (sent via WebSocket text frames). */
export type TerminalClientMessage =
  | { type: 'resize'; cols: number; rows: number };
