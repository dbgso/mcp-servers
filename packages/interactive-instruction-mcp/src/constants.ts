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

/**
 * Directories that hold this server's own files rather than documents.
 *
 * One entry, and one predicate rather than a `startsWith(DRAFT_DIR)` at each
 * call site. There were two: a trash directory took deleted documents so that a
 * delete could be undone. Nothing ever read it, no action restored from it, and
 * the corpora this server runs against keep their history in version control
 * already -- so it was a worse copy of `git checkout`, growing without bound.
 * Grouping the drafts with it is also what hid, for a whole release, that
 * `lint` and `graph` were skipping drafts for a reason written about the trash.
 */
const INTERNAL_DIRS = [DRAFT_DIR];

/**
 * Whether an id belongs to one of those directories.
 *
 * Segment-aware, unlike the prefix tests this replaces: `_mcp_draftsy` is an
 * ordinary document that happens to start with the same letters.
 */
export function isInternalDocument(id: string): boolean {
  return INTERNAL_DIRS.some((dir) => id === dir || id.startsWith(dir + ID_SEPARATOR));
}


