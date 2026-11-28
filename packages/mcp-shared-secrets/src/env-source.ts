import type { SecretSource } from "./source.js";

/**
 * Resolve `env:OTHER_KEY` by looking up another env var.
 * Useful for layering / cross-references in env files.
 */
export function envSource(): SecretSource {
  return new EnvSource();
}

/** {@link SecretSource} that reads another env var — see {@link envSource}. */
export class EnvSource implements SecretSource {
  async fetch(path: string): Promise<string | undefined> {
    return process.env[path];
  }
}
