/**
 * Per-server scoping for the temp directories this server keeps state in.
 *
 * Several of these servers run at once on one machine, each pointed at a
 * different documents directory -- this repo alone wires up three. They used to
 * share a single `$TMPDIR/<name>` store keyed by document id, so a document
 * called `overview` in one project and a document called `overview` in another
 * were the same entry: one server's `apply` could write another server's file,
 * and one project's approved draft could satisfy another project's approval.
 *
 * Scoping by a hash of the resolved documents directory keeps them apart. It is
 * a hash rather than the path itself so the directory name stays short and
 * filesystem-safe, and it is stable across restarts so pending state survives
 * one.
 */

import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

/** Length is a readability choice; collisions are not a concern at this scale. */
const SCOPE_LENGTH = 16;

export function scopeKey(docsDir: string): string {
  return crypto.createHash("sha256").update(path.resolve(docsDir)).digest("hex").slice(0, SCOPE_LENGTH);
}

/**
 * `$TMPDIR/<base>/<scope>`, or `<override>` when one is given -- the env
 * overrides exist so parallel test workers can each get an isolated store.
 */
export function scopedStateDir(params: {
  base: string;
  docsDir: string | null;
  override?: string;
}): string {
  const { base, docsDir, override } = params;
  if (override) return override;
  if (docsDir === null) return path.join(os.tmpdir(), base);
  return path.join(os.tmpdir(), base, scopeKey(docsDir));
}
