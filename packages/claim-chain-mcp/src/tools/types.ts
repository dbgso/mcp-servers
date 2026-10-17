import type { ToolResponse } from "mcp-shared";
import { z } from "zod";
import type { ClaimChain } from "../chain.js";
import type { Claim, Gap } from "../claim.js";

export interface ChainContext {
  chain: ClaimChain;
}

export function textResponse(text: string): ToolResponse {
  return { content: [{ type: "text" as const, text }] };
}

export function errorResponse(text: string): ToolResponse {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** A JSON object in a string: `'{"a":"b"}'`. Anything else is left for the schema to judge. */
function recordFromString(value: unknown): unknown {
  if (typeof value !== "string" || !value.trimStart().startsWith("{")) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * The fields of a claim, also taken as a JSON string.
 *
 * The same reason as `looseArray` in mcp-shared: this tool publishes no
 * argument types, so a client sends an object it has no type for as a string.
 */
export const fieldsSchema = z.preprocess(recordFromString, z.record(z.string(), z.string()));

/** One line naming a claim and what it says. */
export function summaryOf(claim: Claim): string {
  const text = Object.values(claim.fields)[0] ?? "";
  return `**${claim.id}** — ${text}`;
}

export function formatClaim(claim: Claim): string {
  const lines = [`## ${claim.id} (${claim.kind})`, ""];
  for (const [name, value] of Object.entries(claim.fields)) lines.push(`- **${name}**: ${value}`);
  if (claim.refs.length > 0) {
    lines.push(`- **refs**: ${claim.refs.map((ref) => `${ref.id}@${ref.version}`).join(", ")}`);
  }
  return lines.join("\n");
}

export function formatGap(gap: Gap): string {
  const lines = [
    `## ${gap.id} — needs a ${gap.needs} (${gap.status})`,
    "",
    `- **want**: ${gap.want}`,
    `- **under**: ${gap.under.join(", ") || "(nothing cited)"}`,
    `- **draft**: ${gap.draft.kind} ${JSON.stringify(gap.draft.fields)} citing [${gap.draft.refs.join(", ")}]`,
  ];
  if (gap.resolvedBy !== undefined) lines.push(`- **resolved by**: ${gap.resolvedBy}`);
  return lines.join("\n");
}

/** How to write a gap's draft now that a claim answering it exists. */
export function retryOf(params: { gap: Gap; by: string }): string {
  const { gap, by } = params;
  const refs = JSON.stringify([...gap.draft.refs, by]);
  return `execute(action: "add", kind: "${gap.draft.kind}", fields: ${JSON.stringify(gap.draft.fields)}, refs: ${refs}, resolves: "${gap.id}")`;
}
