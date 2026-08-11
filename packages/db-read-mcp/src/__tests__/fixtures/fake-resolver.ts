/**
 * In-memory `SecretResolver` test double — same shape as the one in
 * db-codegen-mcp's tests. Pre-seed via `cache`, `cached(...)` reads it sync,
 * `preload(...)` is a noop.
 */
import type { SecretResolver } from "mcp-shared-secrets";

export interface FakeResolverInit {
  cache?: Record<string, string>;
}

export function fakeResolver(init: FakeResolverInit = {}): SecretResolver {
  const cache = new Map<string, string>(Object.entries(init.cache ?? {}));
  return {
    async resolve(value: string) {
      return value;
    },
    async require(key: string) {
      const v = process.env[key];
      if (v === undefined) throw new Error(`Required env var not set: ${key}`);
      return v;
    },
    async get(key: string) {
      return process.env[key];
    },
    async preload() {
      // Test seam: the seed cache is already populated.
    },
    cached(key: string) {
      const v = cache.get(key);
      if (v === undefined) throw new Error(`Key not preloaded: ${key}`);
      return v;
    },
  };
}
