import type { MarkdownReader } from "../../../services/markdown-reader.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import { parseFrontmatter } from "../../../utils/frontmatter-parser.js";
import type { ToolResponse } from "mcp-shared";
import { gateMutation } from "../../../services/mutation-gate.js";

export { textResponse } from "../types.js";

/**
 * Shared utilities for link_add and link_remove handlers.
 */


/**
 * Where a document actually lives, given the id a caller used.
 *
 * `relatedDocs` name documents by their plain id whether the document is a
 * draft or promoted, but only a promoted one is stored under that id -- a
 * draft is under `_mcp_drafts__`. Reading with the bare id therefore missed
 * every draft, so `link_add` on one answered `Document "x" not found` while
 * the README's table showed the draft column behaving exactly like the
 * promoted one.
 *
 * Promoted wins when both exist, matching `read_meta`. The prefix is where the
 * file is; it is never what the graph calls the document, so nothing here
 * changes what gets written into `relatedDocs`.
 */
export async function resolveStorageId(params: {
  reader: MarkdownReader;
  id: string;
}): Promise<string | null> {
  const { reader, id } = params;

  if (await reader.documentExists(id)) return id;
  if (await reader.documentExists(DRAFT_PREFIX + id)) return DRAFT_PREFIX + id;
  return null;
}

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
    // A draft's neighbours are usually drafts as well, so a target resolves
    // the same way the subject does.
    const storageId = await resolveStorageId({ reader, id: docId });
    if (storageId === null) {
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

  const storageId = await resolveStorageId({ reader, id: startId });
  if (storageId === null) return null;

  const content = await reader.getDocumentContent(storageId);
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

  // One gate covers both actions, which is what makes them share a run key
  // rather than share a gate: `buildLinkApprovalWhat` names the action, so
  // `link_add` and `link_remove` over the same document hash differently and a
  // run started for one cannot be continued by the other.
  return gateMutation({
    operation: "link",
    subject: `instruction::${linkAction}::${id}`,
    what: buildLinkApprovalWhat({ linkAction, id, newRelated }),
    explanation,
    preview,
    work,
  });
}
