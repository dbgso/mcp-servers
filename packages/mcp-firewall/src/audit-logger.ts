import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Rule, RuleAction } from "./types.js";

export interface AuditLogEntry {
  timestamp: string;
  toolName: string;
  args: Record<string, unknown>;
  action: RuleAction | "error";
  ruleId?: string;
  reason: string;
  result?: "executed" | "blocked" | "pending" | "error";
  error?: string;
  // Set when the call was made in dry-run mode, where nothing is blocked or held
  dryRun?: true;
}

export class AuditLogger {
  constructor(private readonly logPath: string) {
    // Ensure directory exists
    const dir = dirname(logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  log(entry: Omit<AuditLogEntry, "timestamp">): void {
    const fullEntry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    const line = JSON.stringify(fullEntry) + "\n";
    appendFileSync(this.logPath, line);
  }

  /**
   * A call that reached the target. `action` is what the rules decided: only
   * `allow` outside a dry run, but in a dry run a denied or held call is
   * forwarded too, and the entry has to say what the rules would have done.
   */
  logExecuted(params: {
    toolName: string;
    args: Record<string, unknown>;
    action: RuleAction;
    rule: Rule | undefined;
    reason: string;
    dryRun: boolean;
  }): void {
    const { toolName, args, action, rule, reason, dryRun } = params;
    this.log({
      toolName,
      args,
      action,
      ruleId: rule?.id,
      reason,
      result: "executed",
      ...(dryRun && { dryRun: true }),
    });
  }

  logDeny(params: {
    toolName: string;
    args: Record<string, unknown>;
    rule: Rule | undefined;
    reason: string;
  }): void {
    const { toolName, args, rule, reason } = params;
    this.log({
      toolName,
      args,
      action: "deny",
      ruleId: rule?.id,
      reason,
      result: "blocked",
    });
  }

  logAsk(params: {
    toolName: string;
    args: Record<string, unknown>;
    rule: Rule;
    reason: string;
  }): void {
    const { toolName, args, rule, reason } = params;
    this.log({
      toolName,
      args,
      action: "ask",
      ruleId: rule.id,
      reason,
      result: "pending",
    });
  }

  logError(params: {
    toolName: string;
    args: Record<string, unknown>;
    error: string;
  }): void {
    const { toolName, args, error } = params;
    this.log({
      toolName,
      args,
      action: "error",
      reason: "Tool execution failed",
      result: "error",
      error,
    });
  }
}
