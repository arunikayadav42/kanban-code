#!/bin/bash
# Kanban Code — Release Builder
#
# Builds a distributable archive containing web (backend + frontend) and mobile app.
# Recipients run setup.sh to install dependencies and start developing.
#
# Usage:
#   ./release.sh                — build release zip
#   ./release.sh --web-only     — web only (no mobile)
#   ./release.sh --mobile-only  — mobile only (includes shared)
#
# Output: kanban-code-<version>.zip

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Parse flags
WEB=true
MOBILE=true
for arg in "$@"; do
  case "$arg" in
    --web-only) MOBILE=false ;;
    --mobile-only) WEB=false ;;
  esac
done

# Version
VERSION=$(node -e "const v=require('./web/package.json').version;if(v)console.log(v)" 2>/dev/null)
[ -z "$VERSION" ] && VERSION=$(date +%Y%m%d-%H%M)

if $WEB && $MOBILE; then
  ZIPNAME="kanban-code-${VERSION}.zip"
elif $WEB; then
  ZIPNAME="kanban-code-web-${VERSION}.zip"
else
  ZIPNAME="kanban-code-mobile-${VERSION}.zip"
fi

ZIPPATH="$DIR/$ZIPNAME"

echo ""
echo "  Building Kanban Code release: $ZIPNAME"
echo ""

# Dependency structure:
#
#   web/shared/     ← shared types + helpers (no runtime deps)
#       ↑
#   web/server/     ← Express backend (depends on shared)
#   web/client/     ← React frontend (depends on shared)
#   mobile/         ← React Native app (depends on shared via Metro)
#
# All node_modules are excluded — recipients run setup.sh to install.

# Build include list
INCLUDES=""

# Always include shared (both web and mobile depend on it)
INCLUDES="$INCLUDES web/shared/"

# Setup + docs
INCLUDES="$INCLUDES web/package.json web/tsconfig.base.json web/dev.sh web/.gitignore"
INCLUDES="$INCLUDES web/ARCHITECTURE.md web/PRIMER.md web/ONBOARD-KIRO-CLI.md"

if $WEB; then
  INCLUDES="$INCLUDES web/server/ web/client/ web/docs/"
fi

if $MOBILE; then
  INCLUDES="$INCLUDES mobile/"
fi

# Top-level files
INCLUDES="$INCLUDES setup.sh release.sh README.md LICENSE CLAUDE.md"

echo "[1/3] Creating archive..."

# Create zip excluding node_modules, dist, android build artifacts, .DS_Store
(cd "$DIR" && zip -r "$ZIPPATH" $INCLUDES \
  -x "*/node_modules/*" \
  -x "*/dist/*" \
  -x "*/.DS_Store" \
  -x "**/.DS_Store" \
  -x "mobile/android/*" \
  -x "mobile/ios/*" \
  -x "mobile/.expo/*" \
  -x "mobile/public/terminal.html" \
  -x "web/server/node_modules/*" \
  -x "web/client/node_modules/*" \
  -x "web/shared/node_modules/*" \
  -x "web/shared/dist/*" \
  -x "**/*.local" \
  -x "**/.env" \
  -x ".superpowers/*" \
  -x "$ZIPNAME" \
) > /dev/null

ZIPSIZE=$(du -h "$ZIPPATH" | cut -f1)
FILECOUNT=$(zipinfo -1 "$ZIPPATH" 2>/dev/null | wc -l | tr -d ' ')
HAS_NODE_MODULES=$(zipinfo -1 "$ZIPPATH" 2>/dev/null | grep -c 'node_modules' || true)

echo "[2/3] Verifying..."
echo ""
echo "  Archive:        $ZIPPATH"
echo "  Size:           $ZIPSIZE"
echo "  Files:          $FILECOUNT"
echo "  node_modules:   $HAS_NODE_MODULES (should be 0)"

if [ "$HAS_NODE_MODULES" -gt 0 ]; then
  echo "  ⚠  WARNING: node_modules found in zip"
fi

echo ""
echo "[3/3] Done."
echo ""
echo "  To use:"
echo "    unzip $ZIPNAME"
echo "    cd kanban-code"
echo "    bash setup.sh"
echo ""
