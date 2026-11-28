import { describe, it, expect } from "vitest";
import { mergeWhitelistAcrossContainers } from "../helpers/merge-whitelist.js";
import type { FieldWhitelist, FieldPolicy } from "../interfaces/whitelist.js";

// In-memory FieldWhitelist double built from a plain policy map. `null` policy
// means "field present but no explicit select" (→ default redact per contract).
type Pol = "expose" | "redact" | "exclude" | null;

function makeWhitelist(cfg: Record<string, Record<string, Pol>>): FieldWhitelist {
  const has = (n: string): n is string => Object.prototype.hasOwnProperty.call(cfg, n);
  return {
    listContainers: () => Object.keys(cfg).sort(),
    hasContainer: has,
    getContainer: (n) => {
      if (!has(n)) return undefined;
      const fields: Record<string, FieldPolicy> = {};
      for (const [f, p] of Object.entries(cfg[n])) fields[f] = p === null ? {} : { select: p };
      return { fields };
    },
    getSelectableFields: (c) =>
      Object.entries(cfg[c] ?? {}).filter(([, p]) => p !== "exclude").map(([f]) => f),
    getFieldPolicy: ({ container, field }) =>
      has(container) ? (cfg[container][field] ?? "redact") : "exclude",
    isEmpty: (c) => has(c) && Object.values(cfg[c]).every((p) => p === "exclude"),
  };
}

describe("mergeWhitelistAcrossContainers — strictest wins", () => {
  it("returns missing (and empties) when any container is not whitelisted", () => {
    const wl = makeWhitelist({ a: { x: "expose" } });
    const r = mergeWhitelistAcrossContainers({ whitelist: wl, containers: ["a", "nope"] as string[] });
    expect(r).toEqual({ allowed: [], excluded: [], redacted: [], missing: ["nope"] });
  });

  it("allowed = intersection of queryable fields across containers", () => {
    const wl = makeWhitelist({
      a: { shared: "expose", onlyA: "expose" },
      b: { shared: "expose", onlyB: "expose" },
    });
    const r = mergeWhitelistAcrossContainers({ whitelist: wl, containers: ["a", "b"] });
    expect(r.allowed.sort()).toEqual(["shared"]); // onlyA/onlyB dropped (not in both)
    expect(r.missing).toEqual([]);
  });

  it("a field excluded in any container is excluded and never allowed", () => {
    const wl = makeWhitelist({
      a: { f: "expose" },
      b: { f: "exclude" },
    });
    const r = mergeWhitelistAcrossContainers({ whitelist: wl, containers: ["a", "b"] });
    expect(r.allowed).toEqual([]);
    expect(r.excluded).toContain("f");
  });

  it("redacted = union of redacted, intersected with allowed", () => {
    const wl = makeWhitelist({
      a: { keep: "expose", secret: "redact" },
      b: { keep: "expose", secret: "redact" },
    });
    const r = mergeWhitelistAcrossContainers({ whitelist: wl, containers: ["a", "b"] });
    expect(r.allowed.sort()).toEqual(["keep", "secret"]);
    expect(r.redacted).toEqual(["secret"]);
  });

  it("redacted drops fields that ended up excluded/unallowed", () => {
    const wl = makeWhitelist({
      a: { s: "redact" },
      b: { s: "exclude" },
    });
    const r = mergeWhitelistAcrossContainers({ whitelist: wl, containers: ["a", "b"] });
    expect(r.allowed).toEqual([]);
    expect(r.excluded).toContain("s");
    expect(r.redacted).toEqual([]); // s not in allowed
  });

  it("field with no explicit select defaults to redact (queryable + redacted)", () => {
    const wl = makeWhitelist({ a: { d: null } });
    const r = mergeWhitelistAcrossContainers({ whitelist: wl, containers: ["a"] });
    expect(r.allowed).toEqual(["d"]);
    expect(r.redacted).toEqual(["d"]);
  });
});
