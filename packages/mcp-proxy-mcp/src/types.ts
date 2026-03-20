import { z } from "zod";

// Condition operators
export const ConditionOperatorSchema = z.enum([
  "equals",
  "contains",
  "matches",
  "exists",
]);
export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;

// Rule condition
export const ConditionSchema = z.object({
  param: z.string(), // Parameter name (dot notation: "args.ref")
  operator: ConditionOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

// Rule action
export const RuleActionSchema = z.enum(["allow", "deny", "ask"]);
export type RuleAction = z.infer<typeof RuleActionSchema>;

// Rule definition
export const RuleSchema = z.object({
  id: z.string(),
  priority: z.number().default(0),
  action: RuleActionSchema,
  toolPattern: z.string(), // Glob pattern: "browser_*", "*"
  conditions: z.array(ConditionSchema).optional(),
  description: z.string().optional(),
});
export type Rule = z.infer<typeof RuleSchema>;

// Rules file structure
export const RulesFileSchema = z.object({
  rules: z.array(RuleSchema),
  defaultAction: RuleActionSchema.default("deny"),
});
export type RulesFile = z.infer<typeof RulesFileSchema>;

// Target MCP configuration
export const TargetConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
});
export type TargetConfig = z.infer<typeof TargetConfigSchema>;

// Proxy configuration file
export const ProxyConfigSchema = z.object({
  target: TargetConfigSchema,
  rulesFile: z.string(),
  defaultAction: RuleActionSchema.optional(),
  dryRun: z.boolean().optional(),
  auditLog: z.string().optional(),
});
export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;

// CLI arguments
export interface CliArgs {
  command?: string;
  args?: string[];
  rulesFile?: string;
  config?: string;
  dryRun?: boolean;
  auditLog?: string;
}

// Rule evaluation result
export interface EvaluationResult {
  action: RuleAction;
  matchedRule?: Rule;
  reason: string;
}

// Pending approval request (for "ask" action)
export interface PendingToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  matchedRule: Rule;
  createdAt: number;
}
