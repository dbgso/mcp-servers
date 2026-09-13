/**
 * Which documents in the directory this server manages.
 *
 * A documents directory is not always all one tool's. This repository's own
 * `./docs` holds `chain/`, which belongs to traceable-chain-mcp: those files
 * have their own frontmatter and their own relation field, so every check this
 * server makes reports them as broken -- 60 of them "missing description", most
 * of the orphan list. A corpus report that is mostly about documents the tool
 * does not own is a report nobody reads.
 *
 * Scope is expressed in document ids, not file paths, because that is what the
 * caller sees: `--exclude chain` reads the same way as the `chain__adr__…` ids
 * it removes.
 */

import { ID_SEPARATOR } from "./document-id.js";

export interface DocumentScope {
  /** When non-empty, only ids under these prefixes are managed. */
  include: string[];
  /** Ids under these prefixes are not managed. Applied after `include`. */
  exclude: string[];
}

export const EMPTY_SCOPE: DocumentScope = { include: [], exclude: [] };

/**
 * Whether `id` is `prefix` itself or sits under it.
 *
 * Segment-aware on purpose: `chain` must not take `chainsaw` with it, so the
 * character after the prefix has to be a separator.
 */
function isUnder(params: { id: string; prefix: string }): boolean {
  const { id, prefix } = params;
  if (id === prefix) return true;
  return id.startsWith(prefix + ID_SEPARATOR);
}

export function isManaged(params: { id: string; scope: DocumentScope }): boolean {
  const { id, scope } = params;

  if (scope.include.length > 0 && !scope.include.some((prefix) => isUnder({ id, prefix }))) {
    return false;
  }
  return !scope.exclude.some((prefix) => isUnder({ id, prefix }));
}

/**
 * A sentence naming the scope, for the places that report on the corpus. A
 * count that silently left documents out is worse than no count.
 */
export function describeScope(scope: DocumentScope): string {
  const parts: string[] = [];
  if (scope.include.length > 0) parts.push(`only ${scope.include.join(", ")}`);
  if (scope.exclude.length > 0) parts.push(`excluding ${scope.exclude.join(", ")}`);
  return parts.length === 0 ? "" : `Scope: ${parts.join("; ")}.`;
}
