import * as os from "node:os";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MarkdownReader } from "./services/markdown-reader.js";
import { PlanReader } from "./services/plan-reader.js";
import { PlanReporter } from "./services/plan-reporter.js";
import { FeedbackReader } from "./services/feedback-reader.js";
import { registerDescriptionTool } from "./tools/description.js";
import { registerHelpTool } from "./tools/help.js";
import { registerDraftTool } from "./tools/draft/index.js";
import { registerApplyTool } from "./tools/apply/index.js";
import { registerPlanTool } from "./tools/plan/index.js";
import { registerApproveTool } from "./tools/approve/index.js";
import type { ReminderConfig } from "./types/index.js";

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
    version: "1.0.0",
  });

  // Shared reader instance for consistent caching
  const reader = new MarkdownReader(markdownDir);

  // Plan reader for task management (OS temp directory)
  const planDir = path.join(os.tmpdir(), "mcp-interactive-instruction-plan");
  const planReader = new PlanReader(planDir);
  const planReporter = new PlanReporter(planDir, planReader);
  const feedbackReader = new FeedbackReader(planDir);

  registerDescriptionTool({ server, config });
  registerHelpTool({ server, reader, config });
  registerDraftTool({ server, reader, config });
  registerApplyTool({ server, reader, config });
  registerPlanTool({ server, planReader, planReporter, feedbackReader, planDir, markdownDir, config });
  registerApproveTool({ server, planReader, planReporter, feedbackReader, markdownDir, config });

  return server;
}
