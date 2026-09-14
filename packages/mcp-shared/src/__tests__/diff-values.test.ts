/**
 * How a structural diff renders the values it found different.
 *
 * `formatValue` had the lowest branch coverage in the file: the cases that
 * exist so a diff stays readable -- a long string truncated, an array reduced
 * to a count, null distinguished from an object -- were the untested ones.
 * Getting them wrong does not throw; it produces a diff a person cannot act
 * on, which is worse.
 */

import { describe, expect, it } from "vitest";

import { diffStructures } from "../utils/diff.js";
import type { DiffableItem } from "../utils/diff.js";

const item = (params: {
  key: string;
  line?: number;
  properties?: Record<string, unknown>;
}): DiffableItem =>
  ({
    key: params.key,
    kind: "function",
    line: params.line ?? 1,
    ...(params.properties === undefined ? {} : { properties: params.properties }),
  }) as DiffableItem;

/** The `details` of the one modified entry, in detailed mode. */
function detailsOf(params: { a: Record<string, unknown>; b: Record<string, unknown> }): string {
  const result = diffStructures({
    itemsA: [item({ key: "f", properties: params.a })],
    itemsB: [item({ key: "f", properties: params.b })],
    options: { level: "detailed" },
  });
  return result.modified[0]?.details ?? "";
}

describe("formatValue, through a detailed diff", () => {
  it("quotes a short string", () => {
    expect(detailsOf({ a: { name: "old" }, b: { name: "new" } })).toBe(
      'name: "old" -> "new"'
    );
  });

  it("truncates a long string, so one property cannot fill the diff", () => {
    const long = "x".repeat(40);

    const details = detailsOf({ a: { doc: long }, b: { doc: `${long}!` } });

    expect(details).toContain('"xxxxxxxxxxxxxxxxxxxx..."');
    expect(details).not.toContain("x".repeat(30));
  });

  it("prints numbers and booleans as themselves", () => {
    expect(detailsOf({ a: { n: 1, flag: true }, b: { n: 2, flag: false } })).toBe(
      "n: 1 -> 2, flag: true -> false"
    );
  });

  it("reduces an array to how many items it has", () => {
    // The point of the diff is that a property changed, not what the whole
    // array now contains.
    expect(detailsOf({ a: { args: [1, 2] }, b: { args: [1, 2, 3] } })).toBe(
      "args: [2 items] -> [3 items]"
    );
  });

  it("tells null apart from an object", () => {
    expect(detailsOf({ a: { ret: null }, b: { ret: { shape: "x" } } })).toBe(
      "ret: null -> {...}"
    );
  });

  it("does not notice a value JSON cannot represent", () => {
    // Two different symbols both stringify to `undefined`, so the comparison
    // sees no change and `formatValue` is never asked about them. The same is
    // true of functions. Written down because it looks like a gap in
    // `formatValue`'s cases and is really a limit of the comparison in front
    // of it -- and because a property like that is not something these
    // structures carry.
    const result = diffStructures({
      itemsA: [item({ key: "f", properties: { u: Symbol("a") } })],
      itemsB: [item({ key: "f", properties: { u: Symbol("b") } })],
      options: { level: "detailed" },
    });

    expect(result.modified).toEqual([]);
  });

  it("marks a property that appeared or went away", () => {
    expect(detailsOf({ a: {}, b: { added: 1 } })).toBe("+added");
    expect(detailsOf({ a: { gone: 1 }, b: {} })).toBe("-gone");
  });

  it("reports nothing for properties that did not move", () => {
    const result = diffStructures({
      itemsA: [item({ key: "f", properties: { same: 1 } })],
      itemsB: [item({ key: "f", properties: { same: 1 } })],
      options: { level: "detailed" },
    });

    expect(result.modified).toEqual([]);
  });
});

describe("ordering and the summary", () => {
  it("sorts added, removed and modified by line", () => {
    // The diff is read top to bottom against the file, so anything else makes
    // the reader jump around.
    const result = diffStructures({
      itemsA: [item({ key: "gone-late", line: 90 }), item({ key: "gone-early", line: 10 })],
      itemsB: [item({ key: "new-late", line: 80 }), item({ key: "new-early", line: 20 })],
    });

    expect(result.added.map((c) => c.key)).toEqual(["new-early", "new-late"]);
    expect(result.removed.map((c) => c.key)).toEqual(["gone-early", "gone-late"]);
  });

  it("sorts the modified entries by their new line", () => {
    const result = diffStructures({
      itemsA: [item({ key: "b", line: 1 }), item({ key: "a", line: 2 })],
      itemsB: [item({ key: "b", line: 90 }), item({ key: "a", line: 5 })],
      options: { level: "detailed" },
    });

    expect(result.modified.map((c) => c.key)).toEqual(["a", "b"]);
  });

  it("says nothing changed when nothing did", () => {
    const result = diffStructures({ itemsA: [item({ key: "f" })], itemsB: [item({ key: "f" })] });

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.modified).toEqual([]);
  });
});
