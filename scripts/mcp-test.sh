#!/bin/bash
# MCP Tool Tester - Test MCP tools without restarting Claude Code
# Usage: ./scripts/mcp-test.sh <package> <tool> '<json_args>'
#
# Examples:
#   ./scripts/mcp-test.sh ast-typescript-mcp ts_ast '{"action":"hover","file_path":"src/index.ts","line":10,"column":5}'
#   ./scripts/mcp-test.sh ast-typescript-mcp ts_ast '{"action":"dead_code","path":"src/handlers"}'
#   ./scripts/mcp-test.sh interactive-instruction-mcp help '{"recursive":true}'

set -e

PACKAGE=$1
TOOL=$2
ARGS=$3

if [ -z "$PACKAGE" ] || [ -z "$TOOL" ]; then
  echo "Usage: $0 <package> <tool> '<json_args>'"
  echo ""
  echo "Packages:"
  ls -1 packages/ | grep -E '^(ast-|interactive-|git-|kroki-|traceable-)' | sed 's/^/  /'
  echo ""
  echo "Example:"
  echo "  $0 ast-typescript-mcp ts_ast '{\"action\":\"hover\",\"file_path\":\"src/index.ts\",\"line\":10,\"column\":5}'"
  exit 1
fi

# Default empty args
if [ -z "$ARGS" ]; then
  ARGS='{}'
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Build JSON-RPC request
REQUEST=$(cat <<EOF
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"$TOOL","arguments":$ARGS}}
EOF
)

# Run the MCP server with the request
cd "$PROJECT_ROOT"
echo "$REQUEST" | npx tsx "./packages/$PACKAGE/src/index.ts" 2>/dev/null | \
  grep -E '^\{' | \
  head -1 | \
  jq -r '.result.content[0].text // .error.message // .' 2>/dev/null || \
  echo "Error: Failed to parse response"
