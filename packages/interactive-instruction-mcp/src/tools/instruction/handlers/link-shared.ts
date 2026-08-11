import type { MarkdownReader } from "../../../services/markdown-reader.js";
import { parseFrontmatter } from "../../../utils/frontmatter-parser.js";

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
 * Pending link change for approval workflow.
 */
export interface PendingLinkChange {
  id: string;
  linkAction: "link_add" | "link_remove";
  relatedDocs: string[];
  timestamp: number;
}

export const pendingChanges = new Map<string, PendingLinkChange>();
