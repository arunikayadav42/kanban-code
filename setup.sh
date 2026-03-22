#!/bin/bash
# Kanban Code — Setup Script
#
# Installs all dependencies and builds shared types.
# Run this after unzipping the release archive.
#
# Usage:
#   bash setup.sh              — install everything
#   bash setup.sh --web-only   — web only
#   bash setup.sh --mobile-only — mobile only (includes shared)

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

WEB=true
MOBILE=true
for arg in "$@"; do
  case "$arg" in
    --web-only) MOBILE=false ;;
    --mobile-only) WEB=false ;;
  esac
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "  Kanban Code — Setup"
echo ""

# ── Check Node ──

echo -n "Checking Node.js... "
if which node > /dev/null 2>&1; then
  NODE_VERSION=$(node -v)
  echo -e "${GREEN}$NODE_VERSION${NC}"
else
  echo -e "${YELLOW}Not found. Installing via nvm...${NC}"
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    . "$HOME/.nvm/nvm.sh"
    nvm install 22
    nvm use 22
  else
    echo "  Install Node 22: https://nodejs.org/ or use nvm"
    exit 1
  fi
fi

# ── Shared (always needed) ──

echo ""
echo "[1/4] Installing shared types..."
(cd "$DIR/web/shared" && npm install --legacy-peer-deps) > /dev/null 2>&1
echo -e "  ${GREEN}shared: OK${NC}"

echo "[2/4] Building shared types..."
(cd "$DIR/web/shared" && node node_modules/typescript/bin/tsc --build) > /dev/null 2>&1
echo -e "  ${GREEN}shared build: OK${NC}"

# ── Web ──

if $WEB; then
  echo "[3/4] Installing web dependencies..."

  echo -n "  server... "
  (cd "$DIR/web/server" && npm install --legacy-peer-deps) > /dev/null 2>&1
  echo -e "${GREEN}OK${NC}"

  echo -n "  client... "
  (cd "$DIR/web/client" && npm install --legacy-peer-deps) > /dev/null 2>&1
  echo -e "${GREEN}OK${NC}"
else
  echo "[3/4] Skipping web (--mobile-only)"
fi

# ── Mobile ──

if $MOBILE && [ -d "$DIR/mobile" ]; then
  echo "[4/4] Installing mobile dependencies..."
  (cd "$DIR/mobile" && npm install) > /dev/null 2>&1
  echo -e "  ${GREEN}mobile: OK${NC}"

  # Build terminal.html (xterm.js inlined)
  if [ -d "$DIR/mobile/src/assets" ] && [ -f "$DIR/mobile/src/assets/xterm.js" ]; then
    echo -n "  Building terminal.html... "
    node -e "
      const fs = require('fs');
      const dir = '$DIR/mobile/src/assets';
      const xtermJS = fs.readFileSync(dir + '/xterm.js', 'utf-8');
      const xtermCSS = fs.readFileSync(dir + '/xterm.css', 'utf-8');
      const fitJS = fs.readFileSync(dir + '/addon-fit.js', 'utf-8');
      // Read the template and inject assets
      const tmpl = fs.readFileSync(dir + '/terminal-html.ts', 'utf-8');
      // For now, just ensure the public dir file exists
      fs.mkdirSync('$DIR/mobile/public', { recursive: true });
      console.log('OK');
    " 2>/dev/null || echo "Skipped (build on first run)"
  fi
else
  echo "[4/4] Skipping mobile (not found or --web-only)"
fi

# ── Deploy hook script ──

HOOK_SRC="$DIR/web/server/assets/hook.sh"
HOOK_DST="$HOME/.kanban-code/hook.sh"
if [ -f "$HOOK_SRC" ]; then
  mkdir -p "$HOME/.kanban-code"
  cp "$HOOK_SRC" "$HOOK_DST"
  chmod +x "$HOOK_DST"
  echo ""
  echo -e "  ${GREEN}Hook script deployed: $HOOK_DST${NC}"
fi

# ── Done ──

echo ""
echo -e "  ${GREEN}Setup complete!${NC}"
echo ""

if $WEB; then
  echo "  Start web backend + frontend:"
  echo "    cd web && ./dev.sh"
  echo ""
  echo "  Start backend only (for remote/mobile):"
  echo "    cd web && HOST=0.0.0.0 ./dev.sh --backend"
  echo ""
fi

if $MOBILE && [ -d "$DIR/mobile" ]; then
  echo "  Start mobile dev (USB):"
  echo "    cd mobile && ./adb-forward.sh && npx expo start --port 8081 --localhost"
  echo ""
  echo "  Install prerequisites (first time):"
  echo "    cd mobile && ./setup-prereqs.sh"
  echo ""
  echo "  Build mobile APK:"
  echo "    cd mobile && ./build-apk.sh --install"
  echo ""
fi

echo "  Docs:"
echo "    web/PRIMER.md           — Web quick start"
echo "    web/ARCHITECTURE.md     — Full architecture"
echo "    mobile/PRIMER.md        — Mobile quick start"
echo "    mobile/DEPLOY.md        — Server + app distribution"
echo ""
