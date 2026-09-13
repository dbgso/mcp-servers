import { DeliberationGate } from "mcp-shared/approval";
import type { MarkdownReader } from "../../../services/markdown-reader.js";
import { parseFrontmatter } from "../../../utils/frontmatter-parser.js";
import type { ToolResponse } from "mcp-shared";
import { textResponse } from "../types.js";

export { textResponse } from "../types.js";

/**
 * Shared utilities for link_add and link_remove handlers.
 */


/**
 * Validate that all target documents exist.
 * Returns list of invalid (non-existent) document IDs.
 */
export async function findInvalidDocs(params: {
  reader: MarkdownReader;
  relatedDocs: string[];
}): Promise<string[]> {
  const { reader, relatedDocs } = params;
  const invalidDocs: string[] = [];
  for (const docId of relatedDocs) {
    const exists = await reader.documentExists(docId);
    if (!exists) {
      invalidDocs.push(docId);
    }
  }
  return invalidDocs;
}

/**
 * Detect circular references that would be created by adding relatedDocs.
 * Returns warning messages for each circular reference found.
 * Detects: self-references, direct back-links, and deeper chain cycles.
 */
export async function detectCircularReferences(params: {
  reader: MarkdownReader;
  id: string;
  relatedDocs: string[];
}): Promise<string[]> {
  const { reader, id, relatedDocs } = params;
  const warnings: string[] = [];

  for (const targetId of relatedDocs) {
    if (targetId === id) {
      warnings.push(`Self-reference: ${id} -> ${id}`);
      continue;
    }

    const cyclePath = await findCyclePath({ reader, startId: targetId, targetId: id, visited: new Set() });
    if (cyclePath) {
      warnings.push(`${id} -> ${cyclePath.join(" -> ")} -> ${id}`);
    }
  }

  return warnings;
}

/**
 * Find a path from startId to targetId through relatedDocs.
 * Returns the path if found, null otherwise.
 */
async function findCyclePath(params: {
  reader: MarkdownReader;
  startId: string;
  targetId: string;
  visited: Set<string>;
}): Promise<string[] | null> {
  const { reader, startId, targetId, visited } = params;

  if (visited.has(startId)) return null;
  visited.add(startId);

  const content = await reader.getDocumentContent(startId);
  if (content === null) return null;

  const frontmatter = parseFrontmatter(content);
  const related = frontmatter.relatedDocs || [];

  if (related.includes(targetId)) {
    return [startId];
  }

  for (const nextId of related) {
    const subPath = await findCyclePath({ reader, startId: nextId, targetId, visited });
    if (subPath) {
      return [startId, ...subPath];
    }
  }

  return null;
}

/**
 * Calculate the new relatedDocs array after adding or removing entries.
 */
export function calculateNewRelatedDocs(params: {
  isAdd: boolean;
  currentRelated: string[];
  relatedDocs: string[];
}): { noChange: boolean; message: string; newRelated: string[] } {
  const { isAdd, currentRelated, relatedDocs } = params;

  if (isAdd) {
    const toAdd = relatedDocs.filter((d) => !currentRelated.includes(d));
    if (toAdd.length === 0) {
      return {
        noChange: true,
        message: "All specified documents are already in relatedDocs.",
        newRelated: currentRelated,
      };
    }
    return {
      noChange: false,
      message: "",
      newRelated: [...currentRelated, ...toAdd],
    };
  }

  // Remove
  const toRemove = relatedDocs.filter((d) => currentRelated.includes(d));
  if (toRemove.length === 0) {
    return {
      noChange: true,
      message: "None of the specified documents are in relatedDocs.",
      newRelated: currentRelated,
    };
  }
  return {
    noChange: false,
    message: "",
    newRelated: currentRelated.filter((d) => !relatedDocs.includes(d)),
  };
}

/**
 * What a link approval is bound to: the resulting list, not the delta the
 * caller asked for.
 *
 * The applied list used to be recomputed from the apply-time arguments while
 * the approval was keyed on the document id alone, so a token approved for
 * `relatedDocs: ["harmless"]` could be spent on `["evil"]` -- and the
 * notification named neither, so the swap was undetectable from the human's
 * side. It is in the notification now too.
 *
 * There is deliberately no separate pending-change map. The one that used to
 * live here was keyed by document id and shared between link_add and
 * link_remove, so two live approvals for one document clobbered each other and
 * stranded a valid token. The approval store already tracks what is pending.
 */
export function buildLinkApprovalWhat(params: {
  linkAction: "link_add" | "link_remove";
  id: string;
  newRelated: string[];
}): string {
  const { linkAction, id, newRelated } = params;
  return [`${linkAction}: ${id}`, `relatedDocs: ${newRelated.join(",")}`].join("\n");
}

/**
 * The gate both link actions go through.
 *
 * Shared deliberately. The two are inverses, and a run started for one must not
 * be continued by the other -- but that falls out of the key rather than out of
 * separate gates: `buildLinkApprovalWhat` names the action, so `link_add` and
 * `link_remove` over the same document hash differently. One gate keeps the
 * eviction sweep and the TTL in one place.
 */
const linkDeliberation = new DeliberationGate();

/** Only for tests: a gate is process memory and outlives a single case. */
export function resetLinkDeliberationForTesting(): void {
  linkDeliberation.resetAllForTesting();
}

/**
 * Put a relatedDocs change behind the deliberation gate.
 *
 * These used to end in an out-of-band token: three calls, and a notification
 * the caller had to get a human to read back. A relatedDocs entry is metadata,
 * and the operation that undoes it is the other one of this pair, so what the
 * change warrants is disclosure rather than consent -- which is what this gate
 * buys, in two calls and without a channel the caller cannot reach. Deletion,
 * renaming and promotion keep their tokens; those are not reversible by asking
 * for the opposite.
 *
 * The preview rides on the refusal rather than being a step of its own. Seeing
 * what will change and being asked to explain it are the same moment, and
 * making them separate calls only meant the explanation was written after the
 * decision.
 */
export async function deliberateLinkChange(params: {
  linkAction: "link_add" | "link_remove";
  id: string;
  newRelated: string[];
  explanation: string;
  preview: string;
  work: () => Promise<ToolResponse>;
}): Promise<ToolResponse> {
  const { linkAction, id, newRelated, explanation, preview, work } = params;

  return linkDeliberation.run({
    request: {
      operation: `instruction::${linkAction}::${id}`,
      what: buildLinkApprovalWhat({ linkAction, id, newRelated }),
      explanation,
    },
    // The run ends only once the frontmatter is written. A failed write leaves
    // it standing so the caller can retry without explaining itself twice.
    succeeded: (response) => response.isError !== true,
    // Refusal is a normal step here, not a fault: `errorResponse` would invite
    // the caller to treat the tool as broken and look for another way in.
    onRefused: (refused) => textResponse(`${preview}\n\n---\n\n${refused.message}`),
    work,
  });
}
