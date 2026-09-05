export const DEFAULT_TIMEOUT_MS = 1_800_000;
export const MAX_TIMEOUT_MS = 86_400_000;
export const DEFAULT_MAX_BLOCK_MS = 240_000;
export const MAX_MAX_BLOCK_MS = 3_600_000;
export const DEFAULT_MAX_WATCHES = 50;
export const MAX_CONSECUTIVE_ERRORS = 5;
export const MAX_EVENTS_PER_WATCH = 20;

/** Read a positive integer from the environment, falling back to the default. */
export function readPositiveInt(params: {
  env: (name: string) => string | undefined;
  name: string;
  fallback: number;
}): number {
  const raw = params.env(params.name);
  if (raw === undefined) {
    return params.fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return params.fallback;
  }
  return Math.floor(value);
}

export interface ServerConfig {
  maxBlockMs: number;
  maxWatches: number;
}

export function loadServerConfig(env: (name: string) => string | undefined): ServerConfig {
  return {
    maxBlockMs: readPositiveInt({ env, name: "WAIT_MCP_MAX_BLOCK_MS", fallback: DEFAULT_MAX_BLOCK_MS }),
    maxWatches: readPositiveInt({ env, name: "WAIT_MCP_MAX_WATCHES", fallback: DEFAULT_MAX_WATCHES }),
  };
}
