#!/bin/bash
# QuotaFlow daemon launcher - sources nvm before running
# Used by launchd to avoid hardcoded Node paths

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd /Users/zion/Repos/Zylo/QuotaFlow
exec npx tsx src/index.ts
