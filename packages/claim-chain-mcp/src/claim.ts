/**
 * Claims and gaps as they are stored, and the version of a claim.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

export const RefSchema = z.object({
  id: z.string().min(1),
  /** The version of the cited claim when it was cited. */
  version: z.string().min(1),
});

export const ClaimSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  fields: z.record(z.string(), z.string()),
  refs: z.array(RefSchema),
});

export const DraftSchema = z.object({
  kind: z.string().min(1),
  fields: z.record(z.string(), z.string()),
  refs: z.array(z.string()),
});

export const GapSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("GAP"),
  /** The kind of claim that is missing upstream. */
  needs: z.string().min(1),
  /** What the draft did cite: the missing claim belongs under these. */
  under: z.array(z.string()),
  /** What has not been decided, in the words of whoever found out. */
  want: z.string().min(1),
  /** The claim that could not be written, kept so it can be written later. */
  draft: DraftSchema,
  status: z.enum(["open", "resolved"]),
  resolvedBy: z.string().optional(),
});

export type Ref = z.infer<typeof RefSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type Draft = z.infer<typeof DraftSchema>;
export type Gap = z.infer<typeof GapSchema>;

/**
 * A claim's version: a hash of what it says.
 *
 * Computed, never stored, so it cannot be forgotten when the claim changes. The
 * refs are left out on purpose: re-pinning a claim to its upstream's new
 * version is acknowledging the change, and must not make everything below it
 * stale in turn.
 */
export function versionOf(claim: Pick<Claim, "kind" | "fields">): string {
  const sorted = Object.keys(claim.fields)
    .sort()
    .map((name) => [name, claim.fields[name]]);
  const canonical = JSON.stringify([claim.kind, sorted]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

