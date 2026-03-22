#!/usr/bin/env bash
# Kanban hook handler for coding assistants (Claude Code, Gemini CLI, Kiro CLI).
# Receives JSON on stdin from hooks, appends a timestamped
# event line to ~/.kanban-code/hook-events.jsonl.
# NO set -euo pipefail — grep returns exit 1 on no match which kills the script.

EVENTS_DIR="${HOME}/.kanban-code"
EVENTS_FILE="${EVENTS_DIR}/hook-events.jsonl"

mkdir -p "$EVENTS_DIR"

input=$(cat)

# Extract fields — each grep can fail (no match), so use || true
session_id=$(echo "$input" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
hook_event=$(echo "$input" | grep -o '"hook_event_name":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
transcript=$(echo "$input" | grep -o '"transcript_path":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

# Fallback: Kiro uses camelCase sessionId
if [ -z "$session_id" ]; then
    session_id=$(echo "$input" | grep -o '"sessionId":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
fi

# Fallback: Kiro uses "event" not "hook_event_name"
if [ -z "$hook_event" ]; then
    hook_event=$(echo "$input" | grep -o '"event":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
fi

# Skip if no session ID found
[ -z "$session_id" ] && exit 0

timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

printf '{"sessionId":"%s","event":"%s","timestamp":"%s","transcriptPath":"%s"}\n' \
    "$session_id" "$hook_event" "$timestamp" "$transcript" >> "$EVENTS_FILE"
