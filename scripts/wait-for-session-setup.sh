#!/bin/bash
# Run an MCP server once the SessionStart hook has installed and built the workspace.
#
# Usage (from .mcp.json): ./scripts/wait-for-session-setup.sh <command> [args...]
#
# Claude Code launches the servers in .mcp.json at the same time as the
# SessionStart hook, not after it. In a cloud session the checkout is fresh,
# so a server launched before `pnpm install` and `pnpm build` finish exits on
# a missing module and is reported as "Connection closed" for the rest of the
# session. .claude/hooks/session-start.sh writes a marker when it is done
# (whether it succeeded or not), and this script holds the server until then.
#
# Local sessions manage their own checkout, so the server starts immediately.

set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  MARKER="$(cd "$(dirname "$0")/.." && pwd)/.claude/session-setup.done"
  TIMEOUT=${SESSION_SETUP_WAIT_SECONDS:-170}

  waited=0
  while [ ! -f "$MARKER" ]; do
    if [ "$waited" -ge "$TIMEOUT" ]; then
      echo "wait-for-session-setup: SessionStart hook did not finish within ${TIMEOUT}s; starting anyway" >&2
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done

  if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" != "0" ]; then
    echo "wait-for-session-setup: SessionStart hook exited with status $(cat "$MARKER"); starting anyway" >&2
  fi
fi

exec "$@"
