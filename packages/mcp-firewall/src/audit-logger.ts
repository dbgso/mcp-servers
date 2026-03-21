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

  logAllow(
    toolName: string,
    args: Record<string, unknown>,
    rule: Rule | undefined,
    reason: string
  ): void {
    this.log({
      toolName,
      args,
      action: "allow",
      ruleId: rule?.id,
      reason,
      result: "executed",
    });
  }

  logDeny(
    toolName: string,
    args: Record<string, unknown>,
    rule: Rule | undefined,
    reason: string
  ): void {
    this.log({
      toolName,
      args,
      action: "deny",
      ruleId: rule?.id,
      reason,
      result: "blocked",
    });
  }

  logAsk(
    toolName: string,
    args: Record<string, unknown>,
    rule: Rule,
    reason: string
  ): void {
    this.log({
      toolName,
      args,
      action: "ask",
      ruleId: rule.id,
      reason,
      result: "pending",
    });
  }

  logError(
    toolName: string,
    args: Record<string, unknown>,
    error: string
  ): void {
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
