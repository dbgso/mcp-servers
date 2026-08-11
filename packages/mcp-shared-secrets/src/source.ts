/**
 * Engine for resolving an opaque path within a single scheme.
 *
 * The resolver passes only the path portion (everything after `<scheme>:`).
 * Implementations don't see the scheme prefix.
 */
export interface SecretSource {
  /** Fetch the value at `path`. Throw if unrecoverable; return undefined for "not found". */
  fetch(path: string): Promise<string | undefined>;
}
