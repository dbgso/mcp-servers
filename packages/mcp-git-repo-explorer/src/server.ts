import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitContext, ReminderConfig } from "./types/index.js";
import { registerDescriptionTool } from "./tools/description.js";
import { registerGitTool } from "./tools/git/index.js";

export function createServer(params: {
  context: GitContext;
  config: ReminderConfig;
}): McpServer {
  const { context, config } = params;

  const server = new McpServer({
    name: "mcp-git-repo-explorer",
    version: "0.1.0",
  });

  registerDescriptionTool({ server, config });
  registerGitTool({ server, context, config });

  return server;
}
