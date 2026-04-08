#!/bin/bash
# QuotaFlow daemon launcher - sources nvm before running
# Used by launchd to avoid hardcoded Node paths

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Ensure claude CLI is on PATH (installed via npm)
export PATH="$HOME/.nvm/versions/node/$(node -v)/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# Auto-detect the QuotaFlow directory (directory containing this script's parent)
QUOTAFLOW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$QUOTAFLOW_DIR"
exec npx tsx src/index.ts
