#!/bin/bash
# Install dependencies and build workspace packages for Claude Code cloud sessions.
#
# The MCP servers in .mcp.json run from source (`npx tsx ./packages/...`), but
# workspace dependencies such as `mcp-shared` resolve through their `dist/`
# exports, so both an install and a build are needed before they can start.
set -euo pipefail

# Local sessions manage their own checkout.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Equivalent of `npm ci`: install exactly what pnpm-lock.yaml pins, and fail
# instead of rewriting the lockfile when it is out of sync with package.json.
pnpm install --frozen-lockfile

pnpm build
