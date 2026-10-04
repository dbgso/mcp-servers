import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

const cacheConfig = {
  dir: path.join(tmpdir(), "git-repo-explorer-gh-cache"),
};

export function setCacheDir(dir: string): void {
  cacheConfig.dir = dir;
}

export function getCacheDir(): string {
  return cacheConfig.dir;
}

function ensureCacheDir(): void {
  if (!existsSync(cacheConfig.dir)) {
    mkdirSync(cacheConfig.dir, { recursive: true });
  }
}

function cacheKeyToPath(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  const safeName = key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  return path.join(cacheConfig.dir, `${safeName}-${hash}.json`);
}

interface CacheEntry<T> {
  data: T;
  createdAt: number;
  ttlMs: number;
  command: string;
}

/** Read a cache file; null when it is missing or not JSON. */
function readEntry<T>(filePath: string): CacheEntry<T> | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as CacheEntry<T>;
  } catch {
    return null;
  }
}

function isExpired(params: { entry: CacheEntry<unknown>; now: number }): boolean {
  const { entry, now } = params;
  return now - entry.createdAt > entry.ttlMs;
}

/** A cache entry that is still fresh, or null. */
function readCache<T>(cachePath: string): CacheEntry<T> | null {
  const entry = readEntry<T>(cachePath);
  if (!entry || isExpired({ entry, now: Date.now() })) return null;
  return entry;
}

function writeCache<T>(params: {
  cachePath: string;
  data: T;
  ttlMs: number;
  command: string;
}): void {
  ensureCacheDir();
  const entry: CacheEntry<T> = {
    data: params.data,
    createdAt: Date.now(),
    ttlMs: params.ttlMs,
    command: params.command,
  };
  writeFileSync(params.cachePath, JSON.stringify(entry, null, 2));
}

/**
 * Check if gh CLI is available and authenticated.
 */
export async function isGhAvailable(): Promise<boolean> {
  try {
    await execFileAsync("gh", ["auth", "status"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Parse output that holds one JSON value per line.
 * `gh api --paginate --jq` applies the filter to each page separately, so a
 * filter like `.[] | {...}` prints one object per line across all pages.
 */
export function parseJsonLines<T>(stdout: string): T[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

/**
 * Execute a gh CLI command with caching.
 * Returns cached result if within TTL, otherwise fetches fresh data.
 */
export async function ghCachedExec<T>(params: {
  args: string[];
  cacheKey: string;
  ttlMs?: number;
  forceRefresh?: boolean;
  /** Turns stdout into data; one JSON document by default. */
  parse?: (stdout: string) => T;
}): Promise<{ data: T; fromCache: boolean; cacheAge?: number }> {
  const ttlMs = params.ttlMs ?? DEFAULT_TTL_MS;
  const cachePath = cacheKeyToPath(params.cacheKey);
  const command = `gh ${params.args.join(" ")}`;

  if (!params.forceRefresh) {
    const cached = readCache<T>(cachePath);
    if (cached) {
      return {
        data: cached.data,
        fromCache: true,
        cacheAge: Math.round((Date.now() - cached.createdAt) / 1000),
      };
    }
  }

  const { stdout } = await execFileAsync("gh", params.args, {
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const parse = params.parse ?? ((out: string) => JSON.parse(out) as T);
  const data = parse(stdout);
  writeCache({ cachePath, data, ttlMs, command });

  return { data, fromCache: false };
}

/**
 * Paths of the regular files in the cache directory.
 * Anything else (a directory someone made there) is not a cache entry.
 */
function listCacheFiles(): string[] {
  if (!existsSync(cacheConfig.dir)) return [];
  return readdirSync(cacheConfig.dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(cacheConfig.dir, entry.name));
}

/**
 * Clear all expired cache entries.
 */
export function cleanExpiredCache(): number {
  const now = Date.now();
  let removedCount = 0;
  for (const filePath of listCacheFiles()) {
    // An unreadable entry is removed along with the expired ones
    const entry = readEntry(filePath);
    if (entry && !isExpired({ entry, now })) continue;
    unlinkSync(filePath);
    removedCount++;
  }
  return removedCount;
}

/**
 * Clear all cache entries.
 */
export function clearAllCache(): number {
  const files = listCacheFiles();
  for (const filePath of files) {
    unlinkSync(filePath);
  }
  return files.length;
}
