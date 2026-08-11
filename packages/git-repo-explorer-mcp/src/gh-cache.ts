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

function readCache<T>(cachePath: string): CacheEntry<T> | null {
  if (!existsSync(cachePath)) return null;
  try {
    const raw = readFileSync(cachePath, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry<T>;
    const age = Date.now() - entry.createdAt;
    if (age > entry.ttlMs) return null;
    return entry;
  } catch {
    return null;
  }
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
 * Execute a gh CLI command with caching.
 * Returns cached result if within TTL, otherwise fetches fresh data.
 */
export async function ghCachedExec<T>(params: {
  args: string[];
  cacheKey: string;
  ttlMs?: number;
  forceRefresh?: boolean;
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

  const data = JSON.parse(stdout) as T;
  writeCache({ cachePath, data, ttlMs, command });

  return { data, fromCache: false };
}

/**
 * Clear all expired cache entries.
 */
export function cleanExpiredCache(): number {
  if (!existsSync(cacheConfig.dir)) return 0;
  const files = readdirSync(cacheConfig.dir);
  const now = Date.now();
  let removedCount = 0;
  for (const file of files) {
    const filePath = path.join(cacheConfig.dir, file);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const entry = JSON.parse(raw) as CacheEntry<unknown>;
      if (now - entry.createdAt > entry.ttlMs) {
        unlinkSync(filePath);
        removedCount++;
      }
    } catch {
      unlinkSync(filePath);
      removedCount++;
    }
  }
  return removedCount;
}

/**
 * Clear all cache entries.
 */
export function clearAllCache(): number {
  if (!existsSync(cacheConfig.dir)) return 0;
  const files = readdirSync(cacheConfig.dir);
  for (const file of files) {
    unlinkSync(path.join(cacheConfig.dir, file));
  }
  return files.length;
}
