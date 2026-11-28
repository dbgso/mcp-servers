import type { MarkdownReader } from "../../../services/markdown-reader.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import type { DocumentFrontmatter } from "../../../types/index.js";
import { parseFrontmatter, updateFrontmatter } from "../../../utils/frontmatter-parser.js";
import type { ToolResponse } from "mcp-shared";
import { errorResponse, formatNextActions, textResponse } from "../types.js";
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
 * The document a link change is about: where it is stored, and what it says.
 *
 * Both halves fail the same way from the caller's side -- an id that resolves to
 * nothing and a document whose content cannot be read are one refusal -- so they
 * are read together rather than as two checks with the same message.
 */
export async function loadLinkTarget(params: {
  reader: MarkdownReader;
  id: string;
}): Promise<{ storageId: string; content: string } | null> {
  const { reader, id } = params;

  // A draft is stored under a prefixed id, so the bare one has to be resolved
  // before anything can be read or written.
  const storageId = await resolveStorageId({ reader, id });
  if (storageId === null) return null;

  const content = await reader.getDocumentContent(storageId);
  if (content === null) return null;

  return { storageId, content };
}

export function refuseMissingDocument(id: string): ToolResponse {
  return errorResponse(`Error: Document "${id}" not found.`);
}

/** An empty list reads as a mistake unless it says so. */
export function formatRelatedDocs(docs: string[]): string {
  return docs.length > 0 ? docs.join(", ") : "(none)";
}

/** Nothing to do is reported as success, with the read that shows why. */
export function reportNoChange(params: { id: string; message: string }): ToolResponse {
  const { id, message } = params;
  return textResponse(
    message +
    formatNextActions([{
      action: "read",
      description: "Read the document",
      example: `instruction(action: "read", id: "${id}")`,
    }]),
  );
}

/** An empty list removes the key: `updateFrontmatter` drops undefined values. */
function withRelatedDocs(params: { frontmatter: DocumentFrontmatter; newRelated: string[] }): DocumentFrontmatter {
  const { frontmatter, newRelated } = params;
  return {
    ...frontmatter,
    relatedDocs: newRelated.length > 0 ? newRelated : undefined,
  };
}

/**
 * The write itself, once the gate has let it through. Returns the failure rather
 * than throwing, which is what `deliberateLinkChange` reads to decide whether
 * the run is over: an exception would mean something unforeseen, and would leave
 * the run standing rather than consuming it.
 *
 * Written through the reader, which is the only write path that normalises the
 * trailing newline, invalidates the list cache and checks that the document is
 * one this server manages. Writing with `fs.writeFile` and a path from
 * `getFilePath` skipped all three -- and the missing newline in #51 was reported
 * for exactly this route alongside the others.
 */
export async function writeRelatedDocs(params: {
  reader: MarkdownReader;
  storageId: string;
  content: string;
  frontmatter: DocumentFrontmatter;
  newRelated: string[];
}): Promise<{ error: string } | null> {
  const { reader, storageId, content, frontmatter, newRelated } = params;

  const newContent = updateFrontmatter({
    content,
    frontmatter: withRelatedDocs({ frontmatter, newRelated }),
  });

  const written = await reader.updateDocument({ id: storageId, content: newContent });
  if (!written.success) {
    return { error: written.error ?? "Unknown error" };
  }
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
    const warning = await circularWarning({ reader, id, targetId });
    if (warning !== null) {
      warnings.push(warning);
    }
  }

  return warnings;
}

/** A self-reference is named directly: the walk below would never look for it. */
async function circularWarning(params: {
  reader: MarkdownReader;
  id: string;
  targetId: string;
}): Promise<string | null> {
  const { reader, id, targetId } = params;

  if (targetId === id) return `Self-reference: ${id} -> ${id}`;

  const cyclePath = await findCyclePath({ reader, startId: targetId, targetId: id, visited: new Set() });
  if (cyclePath === null) return null;
  return `${id} -> ${cyclePath.join(" -> ")} -> ${id}`;
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

  const related = await outgoingLinks({ reader, id: startId });
  if (related.includes(targetId)) {
    return [startId];
  }

  return walkOn({ reader, related, targetId, visited, startId });
}

/**
 * The links out of a document. Not a document, or one that cannot be read, both
 * lead nowhere -- and so does one with no `relatedDocs` -- so the walk treats
 * them alike rather than distinguishing three dead ends.
 */
async function outgoingLinks(params: { reader: MarkdownReader; id: string }): Promise<string[]> {
  const { reader, id } = params;

  const storageId = await resolveStorageId({ reader, id });
  if (storageId === null) return [];

  return relatedDocsOf(await reader.getDocumentContent(storageId));
}

function relatedDocsOf(content: string | null): string[] {
  if (content === null) return [];
  return parseFrontmatter(content).relatedDocs || [];
}

/** The depth-first step, so the path is assembled in one place. */
async function walkOn(params: {
  reader: MarkdownReader;
  related: string[];
  targetId: string;
  visited: Set<string>;
  startId: string;
}): Promise<string[] | null> {
  const { reader, related, targetId, visited, startId } = params;

  for (const nextId of related) {
    const subPath = await findCyclePath({ reader, startId: nextId, targetId, visited });
    if (subPath) {
      return [startId, ...subPath];
    }
  }

  return null;
}

type RelatedDocsChange = { noChange: boolean; message: string; newRelated: string[] };

/**
 * Calculate the new relatedDocs array after adding or removing entries.
 */
export function calculateNewRelatedDocs(params: {
  isAdd: boolean;
  currentRelated: string[];
  relatedDocs: string[];
}): RelatedDocsChange {
  const { isAdd, currentRelated, relatedDocs } = params;

  if (isAdd) return addRelatedDocs({ currentRelated, relatedDocs });
  return removeRelatedDocs({ currentRelated, relatedDocs });
}

function addRelatedDocs(params: { currentRelated: string[]; relatedDocs: string[] }): RelatedDocsChange {
  const { currentRelated, relatedDocs } = params;

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

function removeRelatedDocs(params: { currentRelated: string[]; relatedDocs: string[] }): RelatedDocsChange {
  const { currentRelated, relatedDocs } = params;

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
