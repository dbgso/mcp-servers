import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MarkdownReader } from "./services/markdown-reader.js";
import { registerInstructionTools } from "./tools/instruction/index.js";
import type { ReminderConfig } from "./types/index.js";
import { VERSION } from "./version.js";

const DEFAULT_CONFIG: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

export function createServer(params: {
  markdownDir: string;
  config?: ReminderConfig;
}): McpServer {
  const { markdownDir, config = DEFAULT_CONFIG } = params;
  const server = new McpServer({
    name: "mcp-interactive-instruction",
    version: VERSION,
  });

  const reader = new MarkdownReader(markdownDir);

  registerInstructionTools({ server, reader, config });
  return server;
}
