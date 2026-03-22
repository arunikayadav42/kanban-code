#!/bin/bash
# Kanban Code Web — Dev Server Launcher
# Usage: ./web/dev.sh [--clean|--fresh|--release|--backend|--frontend]
#
# Flags:
#   --clean    — stale cleanup on startup (default)
#   --fresh    — wipe discovered cards and rediscover from disk
#   --release  — clean node_modules, create distribution zip, exit
#   --backend  — start backend server only (no frontend)
#   --frontend — start frontend only (no backend)
#
# Environment variables (all optional):
#   KANBAN_SERVER_PORT  — backend port (default 3000)
#   KANBAN_CLIENT_PORT  — frontend port (default 5173)
#   HOST                — bind address (default 127.0.0.1)
#
# Examples:
#   ./dev.sh                          — start both (default)
#   HOST=0.0.0.0 ./dev.sh --backend   — backend only, accept remote connections
#   ./dev.sh --frontend               — frontend only, set backend URL in Settings

set -e

# Ensure this script is executable (zip may strip permissions)
[ ! -x "$0" ] && chmod +x "$0"

# Parse flags
export KANBAN_STARTUP_MODE="clean"
RELEASE=false
RUN_BACKEND=true
RUN_FRONTEND=true
for arg in "$@"; do
  case "$arg" in
    --clean) export KANBAN_STARTUP_MODE="clean" ;;
    --fresh) export KANBAN_STARTUP_MODE="fresh" ;;
    --release) RELEASE=true ;;
    --backend) RUN_BACKEND=true; RUN_FRONTEND=false ;;
    --frontend) RUN_FRONTEND=true; RUN_BACKEND=false ;;
  esac
done

DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Release mode: clean + build + zip ---
if $RELEASE; then
  echo ""
  echo "  Building Kanban Code Web release..."
  echo ""

  # Clean
  echo "[1/4] Cleaning node_modules and build artifacts..."
  rm -rf "$DIR/shared/node_modules" "$DIR/shared/dist"
  rm -rf "$DIR/server/node_modules"
  rm -rf "$DIR/client/node_modules"
  echo "       Cleaned."

  # Determine version from package.json or fallback to date
  VERSION=$(node -e "const v=require('$DIR/package.json').version;if(v)console.log(v)" 2>/dev/null)
  [ -z "$VERSION" ] && VERSION=$(date +%Y%m%d-%H%M)
  ZIPNAME="kanban-code-web-${VERSION}.zip"
  ZIPPATH="$DIR/$ZIPNAME"

  # Create zip from inside the web directory — paths start with ./
  echo "[2/4] Creating $ZIPNAME..."
  (cd "$DIR" && zip -r "$ZIPPATH" . \
    -x "./shared/node_modules/*" \
    -x "./server/node_modules/*" \
    -x "./client/node_modules/*" \
    -x "./shared/dist/*" \
    -x "./.DS_Store" \
    -x "./**/.DS_Store" \
    -x "./**/*.local" \
    -x "./.env" \
    -x "./$ZIPNAME" \
  )

  ZIPSIZE=$(du -h "$ZIPPATH" | cut -f1)

  echo "[3/4] Verifying zip contents..."
  FILECOUNT=$(zipinfo -1 "$ZIPPATH" | wc -l | tr -d ' ')
  HAS_NODE_MODULES=$(zipinfo -1 "$ZIPPATH" | grep -c 'node_modules' || true)
  HAS_DEV_SH=$(zipinfo -1 "$ZIPPATH" | grep -c 'dev.sh' || true)

  echo ""
  echo "  ✓ Release built: $ZIPPATH"
  echo "    Size:           $ZIPSIZE"
  echo "    Files:          $FILECOUNT"
  echo "    node_modules:   ${HAS_NODE_MODULES} (should be 0)"
  echo "    dev.sh:         ${HAS_DEV_SH} (should be 1)"
  echo ""

  if [ "$HAS_NODE_MODULES" -gt 0 ]; then
    echo "  ⚠  WARNING: node_modules found in zip — check exclusions"
  fi

  echo "[4/4] Distribution ready."
  echo ""
  echo "  To use:"
  echo "    mkdir kanban-code-web && cd kanban-code-web"
  echo "    unzip ../$ZIPNAME"
  echo "    bash dev.sh"
  echo ""

  exit 0
fi

# Configurable ports
export KANBAN_SERVER_PORT="${KANBAN_SERVER_PORT:-3000}"
export KANBAN_CLIENT_PORT="${KANBAN_CLIENT_PORT:-5173}"
export PORT="$KANBAN_SERVER_PORT"

# Load nvm and switch to Node 22 (required for node-pty)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 2>/dev/null || { echo "Node 22 not installed. Run: nvm install 22"; exit 1; }

# Install dependencies — verify tsc binary works, reinstall if broken
install_pkg() {
  local pkg_dir="$1"
  local name="$(basename "$pkg_dir")"
  echo "Installing $name..."
  (cd "$pkg_dir" && npm install --legacy-peer-deps) || { echo "Failed to install $name"; exit 1; }
}

# Verify each package's key modules resolve AND .bin works; clean reinstall if broken
needs_install=false
[ ! -d "$DIR/shared/node_modules" ] && needs_install=true
[ ! -d "$DIR/server/node_modules" ] && needs_install=true
[ ! -d "$DIR/client/node_modules" ] && needs_install=true
# Check for broken .bin symlinks (common when folder is copied instead of npm installed)
[ -L "$DIR/server/node_modules/.bin/tsx" ] && [ ! -e "$DIR/server/node_modules/.bin/tsx" ] && needs_install=true
[ -L "$DIR/client/node_modules/.bin/vite" ] && [ ! -e "$DIR/client/node_modules/.bin/vite" ] && needs_install=true

if $needs_install; then
  echo "Dependencies missing or broken. Clean installing all packages..."
  rm -rf "$DIR/shared/node_modules" "$DIR/server/node_modules" "$DIR/client/node_modules"
  install_pkg "$DIR/shared"
  install_pkg "$DIR/server"
  install_pkg "$DIR/client"
else
  echo "Dependencies OK."
fi

# Build shared types (server + client depend on them)
if [ ! -d "$DIR/shared/dist" ] || find "$DIR/shared/src" -newer "$DIR/shared/dist" -name '*.ts' | grep -q .; then
  echo "Building shared types..."
  (cd "$DIR/shared" && node node_modules/typescript/bin/tsc --build) || { echo "Shared build failed"; exit 1; }
fi

# Deploy hook script for all assistants (Claude, Gemini, Kiro)
HOOK_SCRIPT="$HOME/.kanban-code/hook.sh"
HOOK_SOURCE="$DIR/server/assets/hook.sh"
mkdir -p "$HOME/.kanban-code"
if [ -f "$HOOK_SOURCE" ]; then
  cp "$HOOK_SOURCE" "$HOOK_SCRIPT"
  chmod +x "$HOOK_SCRIPT"
fi

# Auto-install Kiro agent if kiro-cli is available
if which kiro-cli > /dev/null 2>&1; then
  KIRO_AGENT="$HOME/.kiro/agents/kanban_code.json"

  # Generate agent JSON with absolute hook path (Kiro doesn't expand ~)
  mkdir -p "$HOME/.kiro/agents"
  cat > "$KIRO_AGENT" << EOF
{
  "name": "kanban_code",
  "description": "Kiro CLI agent with Kanban Code session tracking hooks",
  "prompt": null,
  "mcpServers": {},
  "tools": ["*"],
  "toolAliases": {},
  "allowedTools": ["*"],
  "resources": [
    "file://.amazonq/rules/**/*.md",
    "file://README.md",
    "file://AmazonQ.md"
  ],
  "hooks": {
    "userPromptSubmit": [{ "command": "$HOOK_SCRIPT" }],
    "agentSpawn": [{ "command": "$HOOK_SCRIPT" }],
    "stop": [{ "command": "$HOOK_SCRIPT" }]
  },
  "toolsSettings": {},
  "useLegacyMcpJson": true
}
EOF
  echo "Kiro agent installed: $KIRO_AGENT"
fi

# Kill any existing instances on the configured ports
$RUN_BACKEND && { kill $(lsof -ti:"$KANBAN_SERVER_PORT") 2>/dev/null || true; }
$RUN_FRONTEND && { kill $(lsof -ti:"$KANBAN_CLIENT_PORT") 2>/dev/null || true; }
sleep 1

echo ""
echo "Starting Kanban Code Web..."
echo ""

PIDS=""

# Start server
if $RUN_BACKEND; then
  (cd "$DIR/server" && node --import tsx/esm src/index.ts) &
  SERVER_PID=$!
  PIDS="$SERVER_PID"
  sleep 2
  BIND="${HOST:-127.0.0.1}"
  echo "  Backend:  http://${BIND}:${KANBAN_SERVER_PORT}"
fi

# Start client
if $RUN_FRONTEND; then
  (cd "$DIR/client" && node node_modules/vite/bin/vite.js --host) &
  CLIENT_PID=$!
  PIDS="$PIDS $CLIENT_PID"
  sleep 2
  echo "  Frontend: http://localhost:${KANBAN_CLIENT_PORT}"
fi

echo ""
if $RUN_BACKEND && ! $RUN_FRONTEND; then
  echo "  Backend only. Set backend URL in frontend Settings to connect."
elif $RUN_FRONTEND && ! $RUN_BACKEND; then
  echo "  Frontend only. Set backend URL in Settings to connect to a remote backend."
else
  echo "  Press Ctrl+C to stop both."
fi
echo ""

# Cleanup on exit
trap "kill $PIDS 2>/dev/null; echo 'Stopped.'" EXIT INT TERM

# Wait for any child to exit
wait
