#!/bin/bash
# One MCP tool call, without restarting Claude Code.
#
# Usage: ./scripts/mcp-test.sh <package> <tool> '<json_args>' [-- <server args>]
#
# Examples:
#   ./scripts/mcp-test.sh ast-typescript-mcp ts_ast '{"action":"dead_code","path":"src/handlers"}'
#   ./scripts/mcp-test.sh interactive-instruction-mcp instruction '{"action":"list"}' -- ./docs
#
# A server that takes arguments of its own needs them after `--`.
# interactive-instruction-mcp requires its documents directory, and this
# script used to omit it: the server exited with a usage error, the error went
# to /dev/null, and the script printed nothing and exited 0. "No output" read
# as "nothing wrong" for as long as that was the documented way to test it.
#
# For anything with state -- a gate that wants the same call twice, a draft
# that has to be added before it can be approved, an update staged before it
# is applied -- one call per process cannot express it. Write a flow instead:
#
#   node scripts/mcp-session.mjs <package> <flow.jsonl> [-- <server args>]
#
# and see scripts/flows/ for what one looks like.

set -euo pipefail

PACKAGE=${1:-}
TOOL=${2:-}
ARGS=${3:-'{}'}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [ -z "$PACKAGE" ] || [ -z "$TOOL" ]; then
  echo "Usage: $0 <package> <tool> '<json_args>' [-- <server args>]"
  echo ""
  echo "Servers:"
  ls -1 "$PROJECT_ROOT/packages" | sed 's/^/  /'
  exit 1
fi

# Everything from the 4th argument on goes to the server.
shift 3 2>/dev/null || shift $#
if [ "${1:-}" = "--" ]; then shift; fi

FLOW=$(mktemp)
trap 'rm -f "$FLOW"' EXIT
printf '{"call": %s, "args": %s}\n' "$(printf '%s' "$TOOL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" "$ARGS" > "$FLOW"

exec node "$SCRIPT_DIR/mcp-session.mjs" "$PACKAGE" "$FLOW" --quiet ${1+--} "$@"
