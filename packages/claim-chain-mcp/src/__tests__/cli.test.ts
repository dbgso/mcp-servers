import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import { DEFAULT_ROOT, parseArgs, runCheck } from "../cli.js";
import type { ClaimChain } from "../chain.js";
import { added, scratchChain, seedChain } from "./helpers.js";

describe("parseArgs", () => {
  it.each([
    [[], { command: "serve", root: path.resolve("/w", DEFAULT_ROOT) }],
    [["claims"], { command: "serve", root: "/w/claims" }],
    [["check"], { command: "check", root: path.resolve("/w", DEFAULT_ROOT) }],
    [["check", "/abs"], { command: "check", root: "/abs" }],
  ])("%j", (argv, expected) => {
    expect(parseArgs({ argv, cwd: "/w" })).toEqual(expected);
  });
});

describe("runCheck", () => {
  let chain: ClaimChain;
  let root: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ chain, root, cleanup } = await scratchChain());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("exits 0 on a clean root", async () => {
    await seedChain(chain);
    const printed: string[] = [];
    expect(await runCheck({ root, print: (text) => printed.push(text) })).toBe(0);
    expect(printed).toEqual(["No findings."]);
  });

  it("exits 1 and says why on an error", async () => {
    const def = await added({ chain, kind: "DEF", fields: { term: "t", meaning: "m" } });
    await added({ chain, kind: "P", fields: { modality: "must", statement: "s" }, refs: [def] });
    const printed: string[] = [];
    expect(await runCheck({ root, print: (text) => printed.push(text) })).toBe(1);
    expect(printed[0]).toMatch(/P-0001 \[uncovered\]/);
  });
});
