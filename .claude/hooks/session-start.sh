#!/bin/bash
# Install dependencies and build workspace packages for Claude Code cloud sessions.
#
# The MCP servers in .mcp.json run from source (`npx tsx ./packages/...`), but
# workspace dependencies such as `mcp-shared` resolve through their `dist/`
# exports, so both an install and a build are needed before they can start.
#
# Claude Code starts those servers alongside this hook rather than after it, so
# they go through scripts/wait-for-session-setup.sh, which waits for the marker
# written here on exit.
set -euo pipefail

# Local sessions manage their own checkout.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

MARKER=.claude/session-setup.done
rm -f "$MARKER"
# Written on failure too: a server waiting on it should start and report its
# own error rather than wait out its timeout.
trap 'echo $? > "$MARKER"' EXIT

# Equivalent of `npm ci`: install exactly what pnpm-lock.yaml pins, and fail
# instead of rewriting the lockfile when it is out of sync with package.json.
pnpm install --frozen-lockfile

pnpm build
