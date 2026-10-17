import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { ClaimChain } from "../chain.js";
import { CONFIG_FILE } from "../kinds.js";
import { added, scratchChain, seedChain } from "./helpers.js";

let chain: ClaimChain;
let root: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ chain, root, cleanup } = await scratchChain());
});

afterEach(async () => {
  await cleanup();
});

function rulesOf(result: { findings?: { rule: string }[] }): string[] {
  return (result.findings ?? []).map((finding) => finding.rule);
}

describe("add", () => {
  it("issues ids per kind, in order", async () => {
    const { def, p, c, s } = await seedChain(chain);
    expect([def, p, c, s]).toEqual(["DEF-0001", "P-0001", "C-0001", "S-0001"]);
    expect(await added({ chain, kind: "DEF", fields: { term: "t", meaning: "m" } })).toBe("DEF-0002");
  });

  it("pins each citation to the cited claim's version", async () => {
    const { p } = await seedChain(chain);
    const { claim } = await chain.read("C-0001");
    expect(claim?.refs).toEqual([{ id: p, version: expect.stringMatching(/^[0-9a-f]{12}$/) }]);
  });

  it.each([
    ["an unknown kind", { kind: "X", fields: {}, refs: [] }, ["unknown-kind"]],
    ["a missing field", { kind: "DEF", fields: { term: "t" }, refs: [] }, ["missing-field"]],
    ["a blank field", { kind: "DEF", fields: { term: "t", meaning: " " }, refs: [] }, ["missing-field"]],
    ["a field it does not have", { kind: "DEF", fields: { term: "t", meaning: "m", unless: "x" }, refs: [] }, ["unknown-field"]],
    ["a citation that does not exist", { kind: "S", fields: { behavior: "b" }, refs: ["C-0099"] }, ["missing-ref", "ref-count"]],
  ])("rejects %s", async (_label, input, rules) => {
    const result = await chain.add(input);
    expect(result.outcome).toBe("rejected");
    expect(rulesOf(result)).toEqual(rules);
  });

  it("rejects a value its field does not allow", async () => {
    const def = await added({ chain, kind: "DEF", fields: { term: "t", meaning: "m" } });
    const result = await chain.add({ kind: "P", fields: { modality: "should", statement: "s" }, refs: [def] });
    expect(rulesOf(result)).toEqual(["invalid-field"]);
  });

  it("rejects citing past the layer above", async () => {
    const { p } = await seedChain(chain);
    const result = await chain.add({ kind: "S", fields: { behavior: "b" }, refs: [p] });
    expect(result.outcome).toBe("rejected");
    expect(rulesOf(result)).toEqual(["wrong-kind", "ref-count"]);
  });

  it("rejects a criterion that judges two principles", async () => {
    const { def, p } = await seedChain(chain);
    const other = await added({ chain, kind: "P", fields: { modality: "must", statement: "s" }, refs: [def] });
    const result = await chain.add({ kind: "C", fields: { condition: "c" }, refs: [p, other] });
    expect(rulesOf(result)).toEqual(["ref-count"]);
    expect(result.outcome === "rejected" && result.findings[0].message).toMatch(/at most 1 P/);
  });

  it("asks for `want` when only upstream is missing", async () => {
    const result = await chain.add({ kind: "S", fields: { behavior: "b" }, refs: [] });
    expect(result).toMatchObject({ outcome: "rejected", needsWant: true });
    expect(await chain.gaps()).toEqual([]);
  });

  it("does not record a gap for a citation that is wrong, only for one that is missing", async () => {
    const result = await chain.add({ kind: "S", fields: { behavior: "b" }, refs: ["C-0042"], want: "w" });
    expect(result).toMatchObject({ outcome: "rejected", needsWant: false });
    expect(await chain.gaps()).toEqual([]);
  });

  it("refuses to resolve a gap that is not open", async () => {
    const result = await chain.add({ kind: "DEF", fields: { term: "t", meaning: "m" }, refs: [], resolves: "GAP-0001" });
    expect(rulesOf(result)).toEqual(["resolves"]);
  });
});

describe("the loop: cannot write, upstream is extended, now can", () => {
  it("records a gap, lists it when the missing claim arrives, and closes it", async () => {
    const { p } = await seedChain(chain);
    const draft = { behavior: "inside an expression, a hidden name evaluates as undefined" };

    const refused = await chain.add({
      kind: "S",
      fields: draft,
      refs: [],
      want: "what may be known when a hidden name is used inside an expression",
    });
    expect(refused.outcome).toBe("gap");
    const [gap] = await chain.gaps();
    expect(gap).toMatchObject({ id: "GAP-0001", needs: "C", under: [], status: "open", draft: { kind: "S", fields: draft } });

    const criterion = await chain.add({
      kind: "C",
      fields: { condition: "inside an expression, a reference to a hidden item reveals nothing" },
      refs: [p],
    });
    expect(criterion.outcome === "added" && criterion.unblocked.map((g) => g.id)).toEqual(["GAP-0001"]);
    expect(await chain.unblocked("C-0002")).toHaveLength(1);

    const written = await chain.add({ kind: "S", fields: draft, refs: ["C-0002"], resolves: "GAP-0001" });
    expect(written).toMatchObject({ outcome: "added", resolved: "GAP-0001", unblocked: [] });
    expect(await chain.gaps()).toEqual([]);
    expect((await chain.read("GAP-0001")).gap).toMatchObject({ status: "resolved", resolvedBy: "S-0002" });
  });

  it("raises a gap one layer further up when the criterion has no principle to cite", async () => {
    const def = await added({ chain, kind: "DEF", fields: { term: "t", meaning: "m" } });
    const result = await chain.add({ kind: "C", fields: { condition: "c" }, refs: [def], want: "which principle this judges" });
    expect(result.outcome === "gap" && result.gaps.map((g) => [g.needs, g.under])).toEqual([["P", [def]]]);

    const principle = await chain.add({ kind: "P", fields: { modality: "must", statement: "s" }, refs: [def] });
    expect(principle.outcome === "added" && principle.unblocked.map((g) => g.id)).toEqual(["GAP-0001"]);
  });

  it("does not offer a gap to a claim it was not waiting for", async () => {
    const { def } = await seedChain(chain);
    const other = await added({ chain, kind: "DEF", fields: { term: "u", meaning: "m" } });
    await chain.add({ kind: "C", fields: { condition: "c" }, refs: [def], want: "w" });

    const unrelated = await chain.add({ kind: "P", fields: { modality: "must", statement: "s" }, refs: [other] });
    expect(unrelated.outcome === "added" && unrelated.unblocked).toEqual([]);
  });
});

describe("update", () => {
  it("makes what cites the old version stale, until it is confirmed", async () => {
    const { c, s } = await seedChain(chain);

    const changed = await chain.update({ id: c, fields: { condition: "a reference to a hidden item reveals neither content nor existence" } });
    expect(changed.outcome === "updated" && changed.nowStale.map((claim) => claim.id)).toEqual([s]);
    expect((await chain.check()).map((f) => [f.id, f.rule])).toEqual([[s, "stale-ref"]]);
    expect((await chain.read(s)).stale).toEqual([c]);

    await chain.update({ id: s, refs: [c] });
    expect(await chain.check()).toEqual([]);
  });

  it("reports nothing stale when the content did not change", async () => {
    const { c } = await seedChain(chain);
    const result = await chain.update({ id: c, refs: ["P-0001"] });
    expect(result).toMatchObject({ outcome: "updated", versionChanged: false, nowStale: [] });
  });

  it("refuses a change that breaks the shape", async () => {
    const { s } = await seedChain(chain);
    const result = await chain.update({ id: s, refs: [] });
    expect(rulesOf(result)).toEqual(["ref-count"]);
  });

  it("refuses a citation that does not exist, without writing", async () => {
    const { s } = await seedChain(chain);
    const result = await chain.update({ id: s, refs: ["C-0404"] });
    expect(rulesOf(result)).toEqual(["missing-ref", "ref-count"]);
    expect(await chain.check()).toEqual([]);
  });

  it("refuses a claim that does not exist", async () => {
    await expect(chain.update({ id: "S-0009" })).rejects.toThrow("S-0009 is not a claim");
  });
});

describe("check", () => {
  it("passes a complete chain", async () => {
    await seedChain(chain);
    expect(await chain.check()).toEqual([]);
  });

  it("reports a principle nothing decides, and a criterion nothing meets", async () => {
    const def = await added({ chain, kind: "DEF", fields: { term: "t", meaning: "m" } });
    const p = await added({ chain, kind: "P", fields: { modality: "must", statement: "s" }, refs: [def] });
    await added({ chain, kind: "C", fields: { condition: "c" }, refs: [p] });
    expect((await chain.check()).map((f) => [f.id, f.rule])).toEqual([["C-0001", "uncovered"]]);
  });

  it("warns about open gaps without failing", async () => {
    await seedChain(chain);
    await chain.add({ kind: "S", fields: { behavior: "b" }, refs: [], want: "w" });
    expect(await chain.check()).toEqual([expect.objectContaining({ id: "GAP-0001", rule: "open-gap", severity: "warning" })]);
  });

  it("checks a claim edited by hand as strictly as `add` would", async () => {
    await seedChain(chain);
    const handEdited = { id: "S-0002", kind: "S", fields: { behavior: "b" }, refs: [{ id: "P-0001", version: "x" }] };
    await writeFile(path.join(root, "S", "S-0002.yaml"), stringifyYaml(handEdited));
    expect((await chain.check()).map((f) => f.rule)).toEqual(["wrong-kind", "ref-count", "stale-ref"]);
  });
});

describe("reading", () => {
  it("lists claims, optionally of one kind", async () => {
    await seedChain(chain);
    expect((await chain.list()).map((c) => c.id)).toEqual(["C-0001", "DEF-0001", "P-0001", "S-0001"]);
    expect((await chain.list("P")).map((c) => c.id)).toEqual(["P-0001"]);
  });

  it("reads a claim with what cites it", async () => {
    const { p, c } = await seedChain(chain);
    const result = await chain.read(p);
    expect(result.claim?.id).toBe(p);
    expect(result.citers.map((claim) => claim.id)).toEqual([c]);
  });

  it("refuses an id that is neither a claim nor a gap", async () => {
    await expect(chain.read("P-0404")).rejects.toThrow("P-0404 does not exist");
  });

  it("traces up to what a claim rests on, and down to what rests on it", async () => {
    await seedChain(chain);
    expect(await chain.trace({ id: "S-0001", direction: "up" })).toEqual({
      id: "S-0001",
      kind: "S",
      children: [
        { id: "C-0001", kind: "C", children: [{ id: "P-0001", kind: "P", children: [{ id: "DEF-0001", kind: "DEF", children: [] }] }] },
      ],
    });
    const down = await chain.trace({ id: "DEF-0001", direction: "down" });
    expect(down.children[0].children[0].children[0].id).toBe("S-0001");
  });
});

describe("kinds from the root's config", () => {
  it("replaces the defaults", async () => {
    const config = {
      kinds: [
        { kind: "REQ", description: "requirement", fields: [{ name: "text" }], refs: [] },
        { kind: "SPEC", description: "spec", fields: [{ name: "text" }], refs: [{ kind: "REQ", min: 1 }] },
      ],
    };
    await writeFile(path.join(root, CONFIG_FILE), stringifyYaml(config));

    const req = await added({ chain, kind: "REQ", fields: { text: "t" } });
    expect(await added({ chain, kind: "SPEC", fields: { text: "t" }, refs: [req] })).toBe("SPEC-0001");
    expect(rulesOf(await chain.add({ kind: "P", fields: {}, refs: [] }))).toEqual(["unknown-kind"]);
  });
});
