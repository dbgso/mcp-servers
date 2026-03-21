import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { PendingStore } from "../pending-store.js";
import type { Rule } from "../types.js";

describe("PendingStore", () => {
  let store: PendingStore;
  const mockRule: Rule = {
    id: "test-rule",
    priority: 100,
    action: "ask",
    toolPattern: "browser_click",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    store = new PendingStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    test("should use default TTL of 10 minutes", () => {
      expect(store.getTtlMs()).toBe(10 * 60 * 1000);
    });

    test("should accept custom TTL", () => {
      const customStore = new PendingStore({ ttlMs: 5 * 60 * 1000 });
      expect(customStore.getTtlMs()).toBe(5 * 60 * 1000);
    });
  });

  describe("add", () => {
    test("should add pending call with expiration", () => {
      vi.setSystemTime(new Date("2025-01-15T10:00:00Z"));

      const pending = store.add("browser_click", { ref: "btn-1" }, mockRule);

      expect(pending.id).toBeDefined();
      expect(pending.toolName).toBe("browser_click");
      expect(pending.args).toEqual({ ref: "btn-1" });
      expect(pending.createdAt).toBe(new Date("2025-01-15T10:00:00Z").getTime());
      expect(pending.expiresAt).toBe(new Date("2025-01-15T10:10:00Z").getTime()); // +10 minutes
    });
  });

  describe("get", () => {
    test("should return pending call if not expired", () => {
      const pending = store.add("browser_click", { ref: "btn-1" }, mockRule);

      // Advance time by 5 minutes (within TTL)
      vi.advanceTimersByTime(5 * 60 * 1000);

      const result = store.get(pending.id);
      expect(result).toBeDefined();
      expect(result?.id).toBe(pending.id);
    });

    test("should return undefined and remove if expired", () => {
      const pending = store.add("browser_click", { ref: "btn-1" }, mockRule);

      // Advance time by 11 minutes (past TTL)
      vi.advanceTimersByTime(11 * 60 * 1000);

      const result = store.get(pending.id);
      expect(result).toBeUndefined();

      // Should be removed from store
      expect(store.count()).toBe(0);
    });
  });

  describe("isExpired", () => {
    test("should return false if not expired", () => {
      const pending = store.add("browser_click", { ref: "btn-1" }, mockRule);

      vi.advanceTimersByTime(5 * 60 * 1000);

      expect(store.isExpired(pending)).toBe(false);
    });

    test("should return true if expired", () => {
      const pending = store.add("browser_click", { ref: "btn-1" }, mockRule);

      vi.advanceTimersByTime(11 * 60 * 1000);

      expect(store.isExpired(pending)).toBe(true);
    });

    test("should return true exactly at expiration", () => {
      const pending = store.add("browser_click", { ref: "btn-1" }, mockRule);

      vi.advanceTimersByTime(10 * 60 * 1000 + 1);

      expect(store.isExpired(pending)).toBe(true);
    });
  });

  describe("list", () => {
    test("should return only non-expired calls", () => {
      store.add("tool1", {}, mockRule);
      vi.advanceTimersByTime(6 * 60 * 1000);

      store.add("tool2", {}, mockRule);
      vi.advanceTimersByTime(5 * 60 * 1000); // tool1 now expired (11 min), tool2 still valid (5 min)

      const list = store.list();
      expect(list).toHaveLength(1);
      expect(list[0].toolName).toBe("tool2");
    });
  });

  describe("cleanup", () => {
    test("should remove all expired calls", () => {
      store.add("tool1", {}, mockRule);
      store.add("tool2", {}, mockRule);
      store.add("tool3", {}, mockRule);

      vi.advanceTimersByTime(11 * 60 * 1000);

      const removed = store.cleanup();
      expect(removed).toBe(3);
      expect(store.count()).toBe(0);
    });

    test("should return 0 if no expired calls", () => {
      store.add("tool1", {}, mockRule);

      vi.advanceTimersByTime(5 * 60 * 1000);

      const removed = store.cleanup();
      expect(removed).toBe(0);
    });
  });

  describe("count", () => {
    test("should return count excluding expired", () => {
      store.add("tool1", {}, mockRule);
      vi.advanceTimersByTime(6 * 60 * 1000);

      store.add("tool2", {}, mockRule);
      vi.advanceTimersByTime(5 * 60 * 1000);

      expect(store.count()).toBe(1); // tool1 expired
    });
  });

  describe("custom TTL", () => {
    test("should respect custom TTL", () => {
      const shortTtlStore = new PendingStore({ ttlMs: 60 * 1000 }); // 1 minute

      const pending = shortTtlStore.add("tool1", {}, mockRule);

      vi.advanceTimersByTime(30 * 1000); // 30 seconds
      expect(shortTtlStore.get(pending.id)).toBeDefined();

      vi.advanceTimersByTime(31 * 1000); // 61 seconds total
      expect(shortTtlStore.get(pending.id)).toBeUndefined();
    });
  });
});
