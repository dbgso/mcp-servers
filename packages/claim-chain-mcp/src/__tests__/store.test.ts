import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { ClaimStore } from "../store.js";
import { scratchChain } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ root, cleanup } = await scratchChain());
});

afterEach(async () => {
  await cleanup();
});

describe("ClaimStore", () => {
  it("reads an empty or absent root as empty", async () => {
    expect(await new ClaimStore(path.join(root, "absent")).snapshot()).toEqual({ claims: new Map(), gaps: new Map() });
  });

  it("issues one past the highest id, never reusing a freed one", async () => {
    await mkdir(path.join(root, "P"));
    await writeFile(path.join(root, "P", "P-0007.yaml"), "");
    await writeFile(path.join(root, "P", "notes.txt"), "");
    expect(await new ClaimStore(root).nextId("P")).toBe("P-0008");
    expect(await new ClaimStore(root).nextId("C")).toBe("C-0001");
  });

  it("gives claims added at the same moment different ids (S-0006)", async () => {
    const store = new ClaimStore(root);
    const build = (id: string) => ({ id, kind: "DEF", fields: { term: id, meaning: "m" }, refs: [] });
    const created = await Promise.all(Array.from({ length: 5 }, () => store.create({ kind: "DEF", build })));

    expect(new Set(created.map((claim) => claim.id)).size).toBe(5);
    expect((await store.snapshot()).claims.size).toBe(5);
  });

  it("passes on a failure that is not a taken id", async () => {
    await writeFile(path.join(root, "DEF"), "a file where the directory would go");
    const build = (id: string) => ({ id, kind: "DEF", fields: {}, refs: [] });
    await expect(new ClaimStore(root).create({ kind: "DEF", build })).rejects.toThrow();
  });

  it("refuses a file that is not a claim, naming it", async () => {
    await mkdir(path.join(root, "P"));
    await writeFile(path.join(root, "P", "P-0001.yaml"), "id: P-0001\n");
    await expect(new ClaimStore(root).snapshot()).rejects.toThrow(/P-0001\.yaml is not a claim/);
  });
});
