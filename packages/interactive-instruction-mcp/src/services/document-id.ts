/**
 * Document id -> file path resolution.
 *
 * Ids are hierarchical: `__` is the path separator, so `git__workflow` means
 * `git/workflow.md`. That makes the id an untrusted path fragment, and the
 * conversion the only thing standing between a caller and the rest of the
 * filesystem -- `..__..__home__.claude__CLAUDE` is a well-formed id under the
 * naive reading. The `update` -> `apply` route carries no approval token, so a
 * traversal here is an unapproved write to any `.md` file the process can
 * reach.
 *
 * Kept as pure functions so the containment property is testable on its own,
 * without a docs directory or a reader.
 */

import * as path from "node:path";

export const ID_SEPARATOR = "__";

/** Thrown when an id would resolve outside the documents directory. */
export class DocumentIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentIdError";
  }
}

export type DocumentIdCheck = { ok: true } | { ok: false; error: string };

/**
 * Whether an id is safe to turn into a path.
 *
 * Deliberately a denylist of what breaks containment rather than an allowlist
 * of characters: ids in the wild are not all ASCII, and rejecting a Japanese
 * document name would break reading files that already exist. What cannot be
 * allowed is anything that changes the meaning of a path segment.
 */
export function checkDocumentId(id: string): DocumentIdCheck {
  const error = idError(id);
  if (error !== undefined) return { ok: false, error };
  return { ok: true };
}

/**
 * The first rule `id` breaks, in the order the caller hears about them, or
 * undefined when it breaks none.
 *
 * The rules are named functions rather than a chain of early returns out of
 * `checkDocumentId` so that the denylist can be read as a list of what is not
 * allowed -- which is the only thing standing between a caller and the rest of
 * the filesystem, and so worth being able to take in at a glance.
 */
function idError(id: string): string | undefined {
  if (isBlank(id)) return "Document ID cannot be empty.";
  return forbiddenCharacterError(id) ?? segmentError(id);
}

function isBlank(id: string): boolean {
  return id === "" || id.trim() === "";
}

/** Characters that change what a path means rather than naming part of one. */
function forbiddenCharacterError(id: string): string | undefined {
  if (id.includes("\0")) return "Document ID cannot contain a null byte.";
  if (hasPathSeparator(id)) {
    return `Invalid document ID "${id}". Use '__' for hierarchy, not a path separator.`;
  }
  return undefined;
}

/**
 * Both separators: on Windows `\` is one too, and this server's documents are
 * shared across machines.
 */
function hasPathSeparator(id: string): boolean {
  return id.includes("/") || id.includes("\\");
}

/** A segment that would not survive the trip through `path.join`. */
function segmentError(id: string): string | undefined {
  const segments = id.split(ID_SEPARATOR);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return `Invalid document ID "${id}". A path segment cannot be "." or "..".`;
  }

  // A segment that is empty (a leading, trailing or tripled separator) has no
  // meaning as a directory name and `path.join` would silently drop it,
  // mapping two different ids onto one file.
  if (segments.some((segment) => segment === "")) {
    return `Invalid document ID "${id}". It has an empty path segment.`;
  }

  return undefined;
}

/**
 * Resolve an id to an absolute `.md` path inside `directory`.
 *
 * The containment assertion after the join is not redundant with
 * `checkDocumentId`: it is the property that actually matters, checked against
 * what the path layer really produced rather than against the string we
 * inspected.
 */
export function resolveDocumentPath(params: {
  directory: string;
  id: string;
}): { ok: true; path: string } | { ok: false; error: string } {
  const { directory, id } = params;

  const check = checkDocumentId(id);
  if (!check.ok) return check;

  const root = path.resolve(directory);
  const resolved = path.resolve(root, ...id.split(ID_SEPARATOR)) + ".md";

  if (escapesRoot({ root, resolved })) {
    return {
      ok: false,
      error: `Invalid document ID "${id}". It resolves outside the documents directory.`,
    };
  }

  return { ok: true, path: resolved };
}

/**
 * Asked of what the path layer actually produced, not of the id we inspected:
 * that is the property that matters, and `path.relative` is the only thing that
 * knows it.
 */
function escapesRoot(params: { root: string; resolved: string }): boolean {
  const relative = path.relative(params.root, params.resolved);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

/**
 * Same as `resolveDocumentPath`, for the internal call sites that have no way
 * to report a failure. Throwing is right there: every one of them is reached
 * through `BaseActionHandler.execute`, which turns a throw into an error
 * response, so a rejected id ends as a message rather than a crash.
 */
export function resolveDocumentPathOrThrow(params: {
  directory: string;
  id: string;
}): string {
  const result = resolveDocumentPath(params);
  if (!result.ok) throw new DocumentIdError(result.error);
  return result.path;
}
