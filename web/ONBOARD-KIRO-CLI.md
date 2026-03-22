# Onboarding Kiro CLI with Kanban Code

## Prerequisites

- [Kiro CLI](https://cli.kiro.dev) installed: `curl -fsSL https://cli.kiro.dev/install | bash`
- Verify: `which kiro-cli` returns a path

## Automatic Setup

When you run `./dev.sh`, it automatically:

1. Detects if `kiro-cli` is installed (`which kiro-cli`)
2. Deploys the hook script to `~/.kanban-code/hook.sh`
3. Creates `~/.kiro/agents/kanban_code.json` with:
   - All tools enabled (`"tools": ["*"]`, `"allowedTools": ["*"]`)
   - Hooks for `userPromptSubmit`, `agentSpawn`, `stop`
   - Absolute path to the hook script (Kiro doesn't expand `~`)

This runs on every startup (idempotent — updates to latest version).

## How It Works

```
Kiro CLI (--agent kanban_code)
    │
    ├── On session start:  fires agentSpawn hook
    ├── On user prompt:    fires userPromptSubmit hook
    └── On session end:    fires stop hook
         │
         ▼
    ~/.kanban-code/hook.sh
         │
         ▼
    ~/.kanban-code/hook-events.jsonl  (appends one JSON line per event)
         │
         ▼
    Kanban Code Server (reads every 5s)
         │
         ▼
    Card appears/updates on the board
```

## Manual Verification

After running `./dev.sh`, verify the setup:

```bash
# 1. Agent file exists with absolute hook path
cat ~/.kiro/agents/kanban_code.json | grep command
# Should show: "command": "/Users/<you>/.kanban-code/hook.sh"

# 2. Hook script is executable
ls -la ~/.kanban-code/hook.sh
# Should show: -rwxr-xr-x

# 3. Test the agent
kiro-cli chat --agent kanban_code
# Session should appear on the Kanban board within 5 seconds
```

## Using a Different Agent

The Kiro plugin descriptor is at `web/server/src/plugins/kiro/descriptor.json`. To use a different agent:

1. Edit `descriptor.json` → change `cliCommand` to `kiro-cli chat --agent <your-agent>`
2. Edit `descriptor.json` → change `hooks.configPath` to `agents/<your-agent>.json`
3. Ensure your agent's JSON at `~/.kiro/agents/<your-agent>.json` has the kanban-code hooks installed

## Troubleshooting

**Card doesn't appear after starting a Kiro session:**
- Check `~/.kanban-code/hook-events.jsonl` — events should be appending
- If empty: hooks aren't firing. Verify `kanban_code.json` has the hook entries
- If populated but no card: check server logs at `~/.kanban-code-web/logs/kanban-code.log`

**"kiro-cli: command not found":**
- Install: `curl -fsSL https://cli.kiro.dev/install | bash`
- Or add to PATH: `export PATH="$HOME/.kiro/bin:$PATH"`

**Hooks in your old `default.json`:**
- If you previously used `--agent default` with Kanban Code, the hooks in `~/.kiro/agents/default.json` are harmless — they only fire when you use `--agent default` directly
- You can leave them or remove the hook entries manually
