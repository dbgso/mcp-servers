import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MarkdownReader } from "./services/markdown-reader.js";
import { EMPTY_SCOPE, type DocumentScope } from "./services/document-scope.js";
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
  scope?: DocumentScope;
}): McpServer {
  const { markdownDir, config = DEFAULT_CONFIG, scope = EMPTY_SCOPE } = params;
  const server = new McpServer({
    name: "mcp-interactive-instruction",
    version: VERSION,
  });

  const reader = new MarkdownReader(markdownDir, scope);

  registerInstructionTools({ server, reader, config });
  return server;
}
