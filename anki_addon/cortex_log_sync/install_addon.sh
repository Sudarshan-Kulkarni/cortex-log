#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$OSTYPE" == "darwin"* ]]; then
  ANKI_ADDONS_DIR="$HOME/Library/Application Support/Anki2/addons21"
else
  ANKI_ADDONS_DIR="$HOME/.local/share/Anki2/addons21"
fi

TARGET_DIR="$ANKI_ADDONS_DIR/cortex_log_sync"

mkdir -p "$TARGET_DIR"
cp "$SCRIPT_DIR/__init__.py" "$TARGET_DIR/__init__.py"
cp "$SCRIPT_DIR/config.json" "$TARGET_DIR/config.json"

echo "Installed Cortex Log Anki add-on to: $TARGET_DIR"
echo "Open (or restart) Anki Desktop, or click Tools -> Sync Cortex Log Cards."
