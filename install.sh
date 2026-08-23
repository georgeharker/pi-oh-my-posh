#!/usr/bin/env bash
# Install pi-oh-my-posh by symlinking the extension into pi's auto-load dir.
# The extension resolves its bundled pi.omp.json via the symlink's real path, so
# the repo can live anywhere.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/extensions"
LINK="$EXT_DIR/pi-oh-my-posh.ts"

mkdir -p "$EXT_DIR"
ln -sf "$SRC_DIR/pi-oh-my-posh.ts" "$LINK"
echo "linked $LINK -> $SRC_DIR/pi-oh-my-posh.ts"

if command -v oh-my-posh >/dev/null 2>&1; then
  echo "oh-my-posh: $(command -v oh-my-posh) ($(oh-my-posh version 2>/dev/null || echo '?'))"
else
  echo "WARNING: oh-my-posh not found on PATH. Install it (https://ohmyposh.dev) or set PI_OMP_BIN." >&2
fi

echo "Done. Start pi; the footer renders via Oh My Posh. Toggle with /oh-my-posh."
