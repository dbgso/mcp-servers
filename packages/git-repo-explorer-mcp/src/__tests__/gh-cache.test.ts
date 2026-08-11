import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";

const { execFilePromiseMock } = vi.hoisted(() => ({
  execFilePromiseMock: vi.fn(),
}));

vi.mock("node:child_process", () => {
  const execFile = vi.fn();
  (execFile as unknown as Record<symbol, unknown>)[
    Symbol.for("nodejs.util.promisify.custom")
  ] = execFilePromiseMock;
  return { execFile };
});

const {
  setCacheDir,
  getCacheDir,
  cleanExpiredCache,
  clearAllCache,
  ghCachedExec,
  isGhAvailable,
} = await import("../gh-cache.js");

const testCacheDir = join(tmpdir(), `gh-cache-test-${Date.now()}`);

beforeAll(() => {
  setCacheDir(testCacheDir);
});

afterAll(() => {
  if (existsSync(testCacheDir)) {
    rmSync(testCacheDir, { recursive: true, force: true });
  }
});

describe("gh-cache file operations", () => {
  it("getCacheDir returns the configured directory", () => {
    expect(getCacheDir()).toBe(testCacheDir);
  });

  it("cleanExpiredCache returns 0 when no cache dir exists", () => {
    if (existsSync(testCacheDir)) rmSync(testCacheDir, { recursive: true, force: true });
    expect(cleanExpiredCache()).toBe(0);
  });

  it("clearAllCache returns 0 when no cache dir exists", () => {
    if (existsSync(testCacheDir)) rmSync(testCacheDir, { recursive: true, force: true });
    expect(clearAllCache()).toBe(0);
  });

  it("cleanExpiredCache removes expired entries", () => {
    mkdirSync(testCacheDir, { recursive: true });
    const expiredEntry = {
      data: { test: true },
      createdAt: Date.now() - 600_000, // 10 min ago
      ttlMs: 300_000, // 5 min TTL = expired
      command: "gh test",
    };
    writeFileSync(join(testCacheDir, "expired-test.json"), JSON.stringify(expiredEntry));
    const removed = cleanExpiredCache();
    expect(removed).toBe(1);
  });

  it("cleanExpiredCache keeps valid entries", () => {
    mkdirSync(testCacheDir, { recursive: true });
    const validEntry = {
      data: { test: true },
      createdAt: Date.now(),
      ttlMs: 300_000,
      command: "gh test",
    };
    writeFileSync(join(testCacheDir, "valid-test.json"), JSON.stringify(validEntry));
    const removed = cleanExpiredCache();
    expect(removed).toBe(0);
    clearAllCache();
  });

  it("cleanExpiredCache removes corrupted (unparseable) entries", () => {
    mkdirSync(testCacheDir, { recursive: true });
    writeFileSync(join(testCacheDir, "corrupted.json"), "{not-json");
    const removed = cleanExpiredCache();
    expect(removed).toBe(1);
  });

  it("clearAllCache removes all entries", () => {
    mkdirSync(testCacheDir, { recursive: true });
    writeFileSync(join(testCacheDir, "a.json"), "{}");
    writeFileSync(join(testCacheDir, "b.json"), "{}");
    const removed = clearAllCache();
    expect(removed).toBe(2);
  });
});

describe("isGhAvailable", () => {
  beforeEach(() => {
    execFilePromiseMock.mockReset();
  });

  it("returns true when `gh auth status` succeeds", async () => {
    execFilePromiseMock.mockResolvedValueOnce({ stdout: "Logged in", stderr: "" });
    expect(await isGhAvailable()).toBe(true);
  });

  it("returns false when `gh auth status` rejects", async () => {
    execFilePromiseMock.mockRejectedValueOnce(new Error("not authenticated"));
    expect(await isGhAvailable()).toBe(false);
  });
});

describe("ghCachedExec", () => {
  beforeEach(() => {
    execFilePromiseMock.mockReset();
    if (existsSync(testCacheDir)) rmSync(testCacheDir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(testCacheDir)) rmSync(testCacheDir, { recursive: true, force: true });
  });

  it("fetches and persists cache on first call", async () => {
    execFilePromiseMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ value: 42 }),
      stderr: "",
    });
    const result = await ghCachedExec<{ value: number }>({
      args: ["api", "test"],
      cacheKey: "first-call",
    });
    expect(result.fromCache).toBe(false);
    expect(result.data).toEqual({ value: 42 });
    expect(result.cacheAge).toBeUndefined();
    expect(execFilePromiseMock).toHaveBeenCalledTimes(1);
    expect(execFilePromiseMock).toHaveBeenCalledWith(
      "gh",
      ["api", "test"],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("returns cached result on second call within TTL", async () => {
    execFilePromiseMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ v: 1 }),
      stderr: "",
    });
    await ghCachedExec({ args: ["api"], cacheKey: "hit" });

    const second = await ghCachedExec<{ v: number }>({ args: ["api"], cacheKey: "hit" });
    expect(second.fromCache).toBe(true);
    expect(second.data).toEqual({ v: 1 });
    expect(second.cacheAge).toBeGreaterThanOrEqual(0);
    expect(execFilePromiseMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache when forceRefresh is true", async () => {
    execFilePromiseMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({ v: "old" }), stderr: "" })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ v: "new" }), stderr: "" });
    await ghCachedExec({ args: ["api"], cacheKey: "force" });

    const second = await ghCachedExec<{ v: string }>({
      args: ["api"],
      cacheKey: "force",
      forceRefresh: true,
    });
    expect(second.fromCache).toBe(false);
    expect(second.data).toEqual({ v: "new" });
    expect(execFilePromiseMock).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when the cache entry has expired", async () => {
    execFilePromiseMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({ x: 1 }), stderr: "" })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ x: 2 }), stderr: "" });
    await ghCachedExec({ args: ["api"], cacheKey: "ttl", ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));

    const second = await ghCachedExec<{ x: number }>({
      args: ["api"],
      cacheKey: "ttl",
      ttlMs: 1,
    });
    expect(second.fromCache).toBe(false);
    expect(second.data).toEqual({ x: 2 });
    expect(execFilePromiseMock).toHaveBeenCalledTimes(2);
  });

  it("falls through to fetch when an existing cache file is unparseable", async () => {
    execFilePromiseMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ ok: true }),
      stderr: "",
    });
    // Pre-write a corrupted cache file under the same key so readCache returns null
    mkdirSync(testCacheDir, { recursive: true });
    await ghCachedExec({ args: ["api"], cacheKey: "broken" });
    // Corrupt every cache file
    for (const f of (await import("node:fs")).readdirSync(testCacheDir)) {
      writeFileSync(join(testCacheDir, f), "{invalid");
    }
    execFilePromiseMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ ok: false }),
      stderr: "",
    });

    const result = await ghCachedExec<{ ok: boolean }>({
      args: ["api"],
      cacheKey: "broken",
    });
    expect(result.fromCache).toBe(false);
    expect(result.data).toEqual({ ok: false });
  });
});
