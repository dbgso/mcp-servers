/**
 * `mergeWhitelistAcrossContainers` — compute the effective whitelist
 * for a search that spans multiple containers. Extracted from CW's
 * `combineWhitelist`; usable by any tool whose SearchReader accepts
 * multiple containers (currently CW only, but the pattern is generic).
 *
 * Semantics: **strictest wins**. A field is `allowed` only if every
 * target container has `expose` on it. Any container declaring
 * `exclude` for a field pushes that field into the `excluded` union.
 * `redacted` is the union of every container's redacted set,
 * intersected with the final `allowed` set.
 *
 * See docs/specs/whitelist-abstraction.md (mergeWhitelistAcrossContainers) / design.
 */

import type { FieldWhitelist } from "../interfaces/whitelist.js";

export interface MergedWhitelist<TContainer extends string> {
  /** Intersection of every container's expose/redact set (queryable). */
  allowed: string[];
  /** Union of every container's excluded set. */
  excluded: string[];
  /** Union of every container's redacted set, intersected with allowed. */
  redacted: string[];
  /** Containers requested but not present in the whitelist. */
  missing: TContainer[];
}

export function mergeWhitelistAcrossContainers<TContainer extends string>(input: {
  whitelist: FieldWhitelist<TContainer, string>;
  containers: readonly TContainer[];
}): MergedWhitelist<TContainer> {
  const { whitelist, containers } = input;

  const missing = containers.filter((c) => !whitelist.hasContainer(c));
  if (missing.length > 0) {
    return { allowed: [], excluded: [], redacted: [], missing };
  }

  const queryableSets: Set<string>[] = [];
  const excludedUnion = new Set<string>();
  const redactedUnion = new Set<string>();

  for (const c of containers) {
    const cfg = whitelist.getContainer(c);
    if (!cfg) continue; // (already guarded above; belt-and-braces)

    const queryable = new Set<string>();
    for (const [name, info] of Object.entries(cfg.fields) as Iterable<
      [string, { select?: "expose" | "redact" | "exclude" }]
    >) {
      const policy = info.select ?? "redact"; // default per catalog §3
      if (policy === "exclude") {
        excludedUnion.add(name);
        continue;
      }
      if (policy === "redact") redactedUnion.add(name);
      queryable.add(name);
    }
    queryableSets.push(queryable);
  }

  // Intersection of queryable sets across containers.
  const first = queryableSets[0];
  if (!first) return { allowed: [], excluded: [], redacted: [], missing: [] };
  const intersection = new Set(first);
  for (const s of queryableSets.slice(1)) {
    for (const x of intersection) if (!s.has(x)) intersection.delete(x);
  }

  const allowed = [...intersection].filter((x) => !excludedUnion.has(x));
  const allowedSet = new Set(allowed);
  const redacted = [...redactedUnion].filter((x) => allowedSet.has(x));

  return {
    allowed,
    excluded: [...excludedUnion],
    redacted,
    missing: [],
  };
}
