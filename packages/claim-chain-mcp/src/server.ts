import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClaimChain } from "./chain.js";
import { registerTools } from "./tools/index.js";
import { VERSION } from "./version.js";

/** Exported so the tools can be driven over an in-memory transport in tests. */
export function createServer(params: { root: string }): McpServer {
  const server = new McpServer({ name: "claim-chain-mcp", version: VERSION });
  registerTools({ server, chain: new ClaimChain(params.root) });
  return server;
}
