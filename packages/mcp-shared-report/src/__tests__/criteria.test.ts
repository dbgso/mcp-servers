import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRITERIA } from "../criteria.js";

describe("CRITERIA", () => {
  it("numbers the criteria R1 to R10 in order", () => {
    expect(CRITERIA.map((criterion) => criterion.id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"]);
  });

  it("defines every criterion the validator names", () => {
    const source = readFileSync(new URL("../validate.ts", import.meta.url), "utf-8");
    const named = new Set([...source.matchAll(/criterion: "(R\d+)"/g)].map((match) => match[1]));
    const defined = new Set(CRITERIA.map((criterion) => criterion.id));
    expect([...named].filter((id) => !defined.has(id))).toEqual([]);
  });
});
