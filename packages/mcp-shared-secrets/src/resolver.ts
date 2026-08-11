import type { SecretSource } from "./source.js";

export interface ParsedUri {
  scheme: string;
  path: string;
}

export interface ParseSecretUriParams {
  value: string;
  knownSchemes: ReadonlySet<string>;
}

/**
 * Parse a value as a secret URI. Returns null when the value is a literal:
 *   - No `:` → literal
 *   - Contains `://` → URL form (e.g. `postgres://...`) → literal
 *   - Scheme not in `knownSchemes` → literal
 *
 * The recognised shape is `<scheme>:<path>` where `<scheme>` matches
 * `[a-z][a-z0-9]*` and `<path>` is non-empty.
 */
export function parseSecretUri(params: ParseSecretUriParams): ParsedUri | null {
  // Treat URL-shaped values as literal (preserves postgres:// / https:// / etc.)
  if (params.value.includes("://")) {
    return null;
  }

  const match = params.value.match(/^([a-z][a-z0-9]*):(.+)$/);
  if (!match) {
    return null;
  }

  const [, scheme, path] = match;
  if (!params.knownSchemes.has(scheme)) {
    return null;
  }

  return { scheme, path };
}

export interface SecretResolverConfig {
  /** Map from scheme name to source (e.g. { ssm: ssmSource(), sm: secretsManagerSource() }). */
  schemes: Record<string, SecretSource>;
}

export interface SecretResolver {
  /** Resolve a single value (URI or literal). */
  resolve(value: string): Promise<string>;
  /** Look up `process.env[key]` then resolve; throws if unset. */
  require(key: string): Promise<string>;
  /** Look up `process.env[key]` then resolve; returns undefined if unset. */
  get(key: string): Promise<string | undefined>;
  /** Eagerly resolve a list of env keys; cached for sync access. */
  preload(keys: string[]): Promise<void>;
  /** Sync access to a previously preloaded key. Throws if not preloaded. */
  cached(key: string): string;
}

export function createSecretResolver(config: SecretResolverConfig): SecretResolver {
  const schemes = config.schemes;
  const knownSchemes = new Set(Object.keys(schemes));
  const cache = new Map<string, string>();

  async function resolveValue(value: string): Promise<string> {
    const parsed = parseSecretUri({ value, knownSchemes });
    if (!parsed) {
      return value;
    }

    // The scheme membership was verified by parseSecretUri, so the source
    // is guaranteed to exist; no defensive check needed here.
    const source = schemes[parsed.scheme];
    const result = await source.fetch(parsed.path);
    if (result === undefined) {
      throw new Error(`Secret not found: ${parsed.scheme}:${parsed.path}`);
    }
    return result;
  }

  async function getValue(key: string): Promise<string | undefined> {
    const v = process.env[key];
    if (v === undefined) {
      return undefined;
    }
    return resolveValue(v);
  }

  async function requireValue(key: string): Promise<string> {
    const v = process.env[key];
    if (v === undefined) {
      throw new Error(`Required env var not set: ${key}`);
    }
    return resolveValue(v);
  }

  async function preload(keys: string[]): Promise<void> {
    const results = await Promise.all(
      keys.map(async (k) => {
        const v = await getValue(k);
        return [k, v] as const;
      }),
    );
    for (const [k, v] of results) {
      if (v !== undefined) {
        cache.set(k, v);
      }
    }
  }

  function cached(key: string): string {
    const v = cache.get(key);
    if (v === undefined) {
      throw new Error(`Key not preloaded: ${key}`);
    }
    return v;
  }

  return {
    resolve: resolveValue,
    require: requireValue,
    get: getValue,
    preload,
    cached,
  };
}
