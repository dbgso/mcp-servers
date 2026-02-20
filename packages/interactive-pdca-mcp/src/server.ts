import * as os from "node:os";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PlanReader } from "./services/plan-reader.js";
import { PlanReporter } from "./services/plan-reporter.js";
import { FeedbackReader } from "./services/feedback-reader.js";
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
    name: "interactive-pdca-mcp",
    version: "1.0.0",
  });

  // Plan reader for task management (OS temp directory)
  const planDir = path.join(os.tmpdir(), "mcp-interactive-instruction-plan");
  const planReader = new PlanReader(planDir);
  const feedbackReader = new FeedbackReader(planDir);
  const planReporter = new PlanReporter(planDir, planReader, feedbackReader);

  registerPlanTool({ server, planReader, planReporter, feedbackReader, planDir, markdownDir, config });
  registerApproveTool({ server, planReader, planReporter, feedbackReader, markdownDir, planDir, config });

  return server;
}
