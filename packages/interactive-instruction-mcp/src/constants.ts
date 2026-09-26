import { ID_SEPARATOR } from "./services/document-id.js";

export const DRAFT_PREFIX = "_mcp_drafts__";
export const DRAFT_DIR = "_mcp_drafts";

export const PLAN_DIR = "tmp";

/**
 * Where a deleted promoted document goes.
 *
 * Deletion is gated by deliberation, which is disclosure and not consent -- so
 * what carries the risk is that the file is still there. Inside the documents
 * directory rather than a temp directory on purpose: it is the user's own tree,
 * so the file is visible, backed up and versioned with everything else, and it
 * outlives a reboot.
 */
export const TRASH_DIR = "_mcp_trash";

/**
 * Directories that hold this server's own files rather than documents.
 *
 * One predicate instead of a `startsWith(DRAFT_DIR)` at each call site. Adding
 * the trash directory to those checks one by one was four edits and a fifth
 * waiting to be forgotten -- `lint` would have reported every trashed document
 * as missing metadata.
 */
const INTERNAL_DIRS = [DRAFT_DIR, TRASH_DIR];

/**
 * Whether an id belongs to one of those directories.
 *
 * Segment-aware, unlike the prefix tests this replaces: `_mcp_draftsy` is an
 * ordinary document that happens to start with the same letters.
 */
export function isInternalDocument(id: string): boolean {
  return INTERNAL_DIRS.some((dir) => id === dir || id.startsWith(dir + ID_SEPARATOR));
}

/**
 * Whether an id belongs to the trash.
 *
 * Apart from `isInternalDocument`, because the two directories are internal for
 * different reasons and only one of them is a reason to ignore a document
 * outright. A trashed document is not a document any more. A draft is a
 * document that is not finished -- and `lint` reads the rules it can answer on
 * its own, which was only ever skipping drafts because they shared a predicate
 * written for the trash.
 */
export function isTrashedDocument(id: string): boolean {
  return id === TRASH_DIR || id.startsWith(TRASH_DIR + ID_SEPARATOR);
}
