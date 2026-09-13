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
