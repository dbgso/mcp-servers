import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ProxyClient } from "./proxy-client.js";
import type { EvaluationResult, RuleAction } from "./types.js";

export type TextContent = { type: "text"; text: string };

/** What the target answered to a forwarded call. */
export type TargetResult = Awaited<ReturnType<ProxyClient["callTool"]>>;

/** The tool result handed back for a forwarded call. */
export type ForwardedResult = CallToolResult & { content: TextContent[] };

/** What the rules would have done with a call a dry run forwarded anyway. */
const DRY_RUN_OUTCOME: Record<RuleAction, string | undefined> = {
  allow: undefined,
  deny: "This call would be blocked",
  ask: "This call would require approval",
};

/** The note put in front of a dry-run result, or nothing for a call the rules allow. */
export function dryRunNote(evaluation: EvaluationResult): TextContent[] {
  const outcome = DRY_RUN_OUTCOME[evaluation.action];
  if (!outcome) return [];
  return [{ type: "text", text: `[DRY-RUN NOTE] ${outcome}: ${evaluation.reason}\n\n---\n\n` }];
}

/**
 * The target's answer as this tool's result, with `prefix` in front of its
 * content and its error flag kept. An answer without a content list is passed
 * on as JSON.
 */
export function forwardedResult(params: { result: TargetResult; prefix: TextContent[] }): ForwardedResult {
  const { result, prefix } = params;
  if (!("content" in result && Array.isArray(result.content))) {
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
  const forwarded: ForwardedResult = { content: [...prefix, ...(result.content as TextContent[])] };
  if (result.isError === true) forwarded.isError = true;
  return forwarded;
}
