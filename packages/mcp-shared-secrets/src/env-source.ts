import type { SecretSource } from "./source.js";

/**
 * Resolve `env:OTHER_KEY` by looking up another env var.
 * Useful for layering / cross-references in env files.
 */
export function envSource(): SecretSource {
  return {
    fetch: async (path) => process.env[path],
  };
}
