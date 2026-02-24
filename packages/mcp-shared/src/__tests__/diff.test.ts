import { describe, it, expect } from "vitest";
import { diffStructures, type DiffableItem } from "../utils/diff.js";

describe("diffStructures", () => {
  describe("summary level", () => {
    it("should detect added items", () => {
      const itemsA: DiffableItem[] = [
        { key: "foo", kind: "function", line: 1 },
      ];
      const itemsB: DiffableItem[] = [
        { key: "foo", kind: "function", line: 1 },
        { key: "bar", kind: "function", line: 5 },
      ];

      const result = diffStructures({ itemsA, itemsB, options: { level: "summary" } });

      expect(result.added).toHaveLength(1);
      expect(result.added[0].key).toBe("bar");
      expect(result.added[0].lineB).toBe(5);
      expect(result.removed).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.summary).toBe("Added 1");
    });

    it("should detect removed items", () => {
      const itemsA: DiffableItem[] = [
        { key: "foo", kind: "function", line: 1 },
        { key: "bar", kind: "function", line: 5 },
      ];
      const itemsB: DiffableItem[] = [
        { key: "foo", kind: "function", line: 1 },
      ];

      const result = diffStructures({ itemsA, itemsB, options: { level: "summary" } });

      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(1);
      expect(result.removed[0].key).toBe("bar");
      expect(result.removed[0].lineA).toBe(5);
      expect(result.modified).toHaveLength(0);
      expect(result.summary).toBe("Removed 1");
    });

    it("should detect kind changes as modifications", () => {
      const itemsA: DiffableItem[] = [
        { key: "foo", kind: "function", line: 1 },
      ];
      const itemsB: DiffableItem[] = [
        { key: "foo", kind: "class", line: 1 },
      ];

      const result = diffStructures({ itemsA, itemsB, options: { level: "summary" } });

      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.modified).toHaveLength(1);
      expect(result.modified[0].key).toBe("foo");
      expect(result.modified[0].details).toContain("kind: function -> class");
      expect(result.summary).toBe("Modified 1");
    });

    it("should not report line changes in summary mode", () => {
      const itemsA: DiffableItem[] = [
        { key: "foo", kind: "function", line: 1 },
      ];
      const itemsB: DiffableItem[] = [
        { key: "foo", kind: "function", line: 10 },
      ];

      const result = diffStructures({ itemsA, itemsB, options: { level: "summary" } });

      expect(result.modified).toHaveLength(0);
      expect(result.summary).toBe("No changes");
    });

    it("should return empty results for identical items", () => {
      const items: DiffableItem[] = [
        { key: "foo", kind: "function", line: 1 },
        { key: "bar", kind: "class", line: 5 },
      ];

      const result = diffStructures({ itemsA: items, itemsB: items, options: { level: "summary" } });

      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.summary).toBe("No changes");
    });

    it("should handle empty arrays", () => {
      const result = diffStructures({ itemsA: [], itemsB: [], options: { level: "summary" } });

      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.summary).toBe("No changes");
    });

    it("should detect multiple changes", () => {
      const itemsA: DiffableItem[] = [
        { key: "foo", kind: "function", line: 1 },
        { key: "bar", kind: "function", line: 5 },
        { key: "baz", kind: "class", line: 10 },
      ];
      const itemsB: DiffableItem[] = [
        { key: "bar", kind: "variable", line: 5 },
        { key: "qux", kind: "interface", line: 15 },
      ];

      const result = diffStructures({ itemsA, itemsB, options: { level: "summary" } });

      expect(result.added).toHaveLength(1);
      expect(result.added[0].key).toBe("qux");
      expect(result.removed).toHaveLength(2);
      expect(result.removed.map(r => r.key)).toContain("foo");
      expect(result.removed.map(r => r.key)).toContain("baz");
      expect(result.modified).toHaveLength(1);
      expect(result.modified[0].key).toBe("bar");
      expect(result.summary).toBe("Added 1, Removed 2, Modified 1");
    });
  });

  describe("detailed level", () => {
    it("should report line changes in detailed mode", () => {
      const itemsA: DiffableItem[] = [
        { key: "foo", kind: "function", line: 1 },
      ];
      const itemsB: DiffableItem[] = [
        { key: "foo", kind: "function", line: 10 },
      ];

      const result = diffStructures({ itemsA, itemsB, options: { level: "detailed" } });

      expect(result.modified).toHaveLength(1);
      expect(result.modified[0].details).toContain("line: 1 -> 10");
    });

    it("should detect property changes in detailed mode", () => {
      const itemsA: DiffableItem[] = [
        { key: "foo", kind: "class", line: 1, properties: { members: 5, exported: true } },
      ];
      const itemsB: DiffableItem[] = [
        { key: "foo", kind: "class", line: 1, properties: { members: 10, exported: true } },
      ];

      const result = diffStructures({ itemsA, itemsB, options: { level: "detailed" } });

      expect(result.modified).toHaveLength(1);
      expect(result.modified[0].details).toContain("members: 5 -> 10");
    });

    it("should detect added properties", () => {
      const itemsA: DiffableItem[] = [
        { key: "foo", kind: "class", line: 1, properties: { exported: true } },
      ];
      const itemsB: DiffableItem[] = [
        { key: "foo", kind: "class", line: 1, properties: { exported: true, members: 5 } },
      ];

      const result = diffStructures({ itemsA, itemsB, options: { level: "detailed" } });

      expect(result.modified).toHaveLength(1);
      expect(result.modified[0].details).toContain("+members");
    });

    it("should detect removed properties", () => {
      const itemsA: DiffableItem[] = [
        { key: "foo", kind: "class", line: 1, properties: { exported: true, members: 5 } },
      ];
      const itemsB: DiffableItem[] = [
        { key: "foo", kind: "class", line: 1, properties: { exported: true } },
      ];

      const result = diffStructures({ itemsA, itemsB, options: { level: "detailed" } });

      expect(result.modified).toHaveLength(1);
      expect(result.modified[0].details).toContain("-members");
    });

    it("should handle complex property changes", () => {
      const itemsA: DiffableItem[] = [
        { key: "foo", kind: "function", line: 1, properties: {
          name: "shortName",
          count: 5,
          items: [1, 2, 3],
        } },
      ];
      const itemsB: DiffableItem[] = [
        { key: "foo", kind: "function", line: 1, properties: {
          name: "aVeryLongNameThatExceedsTwentyCharacters",
          count: 10,
          items: [1, 2, 3, 4],
        } },
      ];

      const result = diffStructures({ itemsA, itemsB, options: { level: "detailed" } });

      expect(result.modified).toHaveLength(1);
      expect(result.modified[0].details).toContain('name: "shortName" ->');
      expect(result.modified[0].details).toContain("...");
      expect(result.modified[0].details).toContain("count: 5 -> 10");
      expect(result.modified[0].details).toContain("items: [3 items] -> [4 items]");
    });
  });

  describe("sorting", () => {
    it("should sort added items by line number", () => {
      const itemsA: DiffableItem[] = [];
      const itemsB: DiffableItem[] = [
        { key: "c", kind: "function", line: 30 },
        { key: "a", kind: "function", line: 10 },
        { key: "b", kind: "function", line: 20 },
      ];

      const result = diffStructures({ itemsA, itemsB, options: { level: "summary" } });

      expect(result.added.map(a => a.key)).toEqual(["a", "b", "c"]);
    });

    it("should sort removed items by line number", () => {
      const itemsA: DiffableItem[] = [
        { key: "c", kind: "function", line: 30 },
        { key: "a", kind: "function", line: 10 },
        { key: "b", kind: "function", line: 20 },
      ];
      const itemsB: DiffableItem[] = [];

      const result = diffStructures({ itemsA, itemsB, options: { level: "summary" } });

      expect(result.removed.map(r => r.key)).toEqual(["a", "b", "c"]);
    });

    it("should sort modified items by new line number", () => {
      const itemsA: DiffableItem[] = [
        { key: "c", kind: "a", line: 30 },
        { key: "a", kind: "a", line: 10 },
        { key: "b", kind: "a", line: 20 },
      ];
      const itemsB: DiffableItem[] = [
        { key: "c", kind: "b", line: 15 },
        { key: "a", kind: "b", line: 5 },
        { key: "b", kind: "b", line: 25 },
      ];

      const result = diffStructures({ itemsA, itemsB, options: { level: "summary" } });

      expect(result.modified.map(m => m.key)).toEqual(["a", "c", "b"]);
    });
  });

  describe("default options", () => {
    it("should use summary level by default", () => {
      const itemsA: DiffableItem[] = [
        { key: "foo", kind: "function", line: 1 },
      ];
      const itemsB: DiffableItem[] = [
        { key: "foo", kind: "function", line: 10 },
      ];

      const result = diffStructures({ itemsA, itemsB });

      // In summary mode, line changes are not reported
      expect(result.modified).toHaveLength(0);
    });
  });
});
