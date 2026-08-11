import { describe, it, expect } from "vitest";
import {
  encodeCursor,
  decodeCursor,
  paginate,
} from "../utils/pagination.js";

describe("pagination utilities", () => {
  describe("encodeCursor / decodeCursor", () => {
    it("should encode and decode offset correctly", () => {
      const offset = 10;
      const cursor = encodeCursor(offset);
      expect(decodeCursor(cursor)).toBe(offset);
    });

    it("should return 0 for undefined cursor", () => {
      expect(decodeCursor(undefined)).toBe(0);
    });

    it("should return 0 for invalid cursor", () => {
      expect(decodeCursor("invalid")).toBe(0);
    });

    it("should return 0 for empty string", () => {
      expect(decodeCursor("")).toBe(0);
    });

    it("should handle large offsets", () => {
      const offset = 1000000;
      const cursor = encodeCursor(offset);
      expect(decodeCursor(cursor)).toBe(offset);
    });
  });

  describe("paginate", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    describe("without limit (return all)", () => {
      it("should return all items when no limit specified", () => {
        const result = paginate({ items, pagination: {} });
        expect(result.data).toEqual(items);
        expect(result.total).toBe(10);
        expect(result.hasMore).toBe(false);
        expect(result.nextCursor).toBeUndefined();
      });

      it("should return items from cursor when no limit specified", () => {
        const cursor = encodeCursor(5);
        const result = paginate({ items, pagination: { cursor } });
        expect(result.data).toEqual([6, 7, 8, 9, 10]);
        expect(result.total).toBe(10);
        expect(result.hasMore).toBe(false);
        expect(result.nextCursor).toBeUndefined();
      });
    });

    describe("with limit", () => {
      it("should return first page correctly", () => {
        const result = paginate({ items, pagination: { limit: 3 } });
        expect(result.data).toEqual([1, 2, 3]);
        expect(result.total).toBe(10);
        expect(result.hasMore).toBe(true);
        expect(result.nextCursor).toBeDefined();
      });

      it("should return second page using cursor", () => {
        const page1 = paginate({ items, pagination: { limit: 3 } });
        const page2 = paginate({ items, pagination: { cursor: page1.nextCursor, limit: 3 } });
        expect(page2.data).toEqual([4, 5, 6]);
        expect(page2.total).toBe(10);
        expect(page2.hasMore).toBe(true);
      });

      it("should return last page correctly", () => {
        const cursor = encodeCursor(9);
        const result = paginate({ items, pagination: { cursor, limit: 3 } });
        expect(result.data).toEqual([10]);
        expect(result.total).toBe(10);
        expect(result.hasMore).toBe(false);
        expect(result.nextCursor).toBeUndefined();
      });

      it("should handle exact page boundary", () => {
        const result = paginate({ items, pagination: { limit: 5 } });
        expect(result.data).toEqual([1, 2, 3, 4, 5]);
        expect(result.hasMore).toBe(true);

        const page2 = paginate({ items, pagination: { cursor: result.nextCursor, limit: 5 } });
        expect(page2.data).toEqual([6, 7, 8, 9, 10]);
        expect(page2.hasMore).toBe(false);
      });

      it("should return empty array when cursor is past end", () => {
        const cursor = encodeCursor(100);
        const result = paginate({ items, pagination: { cursor, limit: 3 } });
        expect(result.data).toEqual([]);
        expect(result.total).toBe(10);
        expect(result.hasMore).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle empty array", () => {
        const result = paginate({ items: [], pagination: { limit: 10 } });
        expect(result.data).toEqual([]);
        expect(result.total).toBe(0);
        expect(result.hasMore).toBe(false);
      });

      it("should handle limit larger than items", () => {
        const result = paginate({ items, pagination: { limit: 100 } });
        expect(result.data).toEqual(items);
        expect(result.total).toBe(10);
        expect(result.hasMore).toBe(false);
      });

      it("should handle limit of 1", () => {
        const result = paginate({ items, pagination: { limit: 1 } });
        expect(result.data).toEqual([1]);
        expect(result.hasMore).toBe(true);
      });

      it("should work with object arrays", () => {
        const objects = [{ id: 1 }, { id: 2 }, { id: 3 }];
        const result = paginate({ items: objects, pagination: { limit: 2 } });
        expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
        expect(result.total).toBe(3);
        expect(result.hasMore).toBe(true);
      });
    });

    describe("full pagination iteration", () => {
      it("should iterate through all pages", () => {
        let cursor: string | undefined;
        const allData: number[] = [];

        do {
          const result = paginate({ items, pagination: { cursor, limit: 3 } });
          allData.push(...result.data);
          cursor = result.nextCursor;
        } while (cursor);

        expect(allData).toEqual(items);
      });
    });
  });
});
