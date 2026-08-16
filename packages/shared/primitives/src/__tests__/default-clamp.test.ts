import { describe, it, expect } from "vitest";
import { defaultClamp } from "../helpers/default-clamp.js";

// Contract source: docs/specs/whitelist-abstraction.md (Limit clamp) +
// interfaces/limit-policy.ts. Tests are written from the spec before the impl.

describe("defaultClamp — LimitPolicy factory", () => {
  it("exposes the (normalised) defaultLimit and maxLimit", () => {
    const p = defaultClamp({ defaultLimit: 20, maxLimit: 100 });
    expect(p.defaultLimit).toBe(20);
    expect(p.maxLimit).toBe(100);
  });

  it("normalises defaultLimit down to maxLimit when it exceeds it", () => {
    const p = defaultClamp({ defaultLimit: 500, maxLimit: 100 });
    expect(p.defaultLimit).toBe(100);
    expect(p.clamp(undefined)).toBe(100);
  });

  const p = defaultClamp({ defaultLimit: 20, maxLimit: 100 });
  it.each([
    { name: "undefined -> defaultLimit", input: undefined, expected: 20 },
    { name: "NaN -> defaultLimit", input: NaN, expected: 20 },
    { name: "Infinity -> defaultLimit", input: Infinity, expected: 20 },
    { name: "-Infinity -> defaultLimit", input: -Infinity, expected: 20 },
    { name: "0 -> 1", input: 0, expected: 1 },
    { name: "negative -> 1", input: -5, expected: 1 },
    { name: "sub-1 fraction -> 1", input: 0.5, expected: 1 },
    { name: "over max -> maxLimit", input: 100000, expected: 100 },
    { name: "in-range integer -> itself", input: 42, expected: 42 },
    { name: "in-range fraction -> floor", input: 3.7, expected: 3 },
    { name: "exactly max -> max", input: 100, expected: 100 },
    { name: "exactly 1 -> 1", input: 1, expected: 1 },
  ])("clamp: $name", ({ input, expected }) => {
    expect(p.clamp(input)).toBe(expected);
  });

  it.each([undefined, NaN, Infinity, -1, 0, 0.4, 1, 50, 100, 1e9])(
    "clamp always returns a value within [1, maxLimit] (input=%s)",
    (input) => {
      const v = p.clamp(input as number | undefined);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(100);
      expect(Number.isInteger(v)).toBe(true);
    },
  );
});
