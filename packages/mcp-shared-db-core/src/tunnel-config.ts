/**
 * Tunnel configuration for the DB servers, read from one env layout under a
 * per-server prefix (`DBREAD_*` for db-read-mcp, `DBGEN_*` for
 * db-codegen-mcp):
 *
 *   - `<P>_BASTION_HOST` set → `{ bastion: ... }` (`<P>_BASTION_KEY` optional)
 *   - `<P>_SSM_TARGET` set   → `{ ssm: ... }`
 *   - both set               → throw (the operator must pick one)
 *   - neither                → `null` (direct connection)
 *
 * Both servers, and the codegen tools' env fallback, used to carry their own
 * copy of this rule.
 */
import {
  ssmConfigFromEnv,
  type BastionConfig,
  type SsmTunnelEnvConfig,
  type TunnelSpec,
} from "mcp-shared/tunnel";

/**
 * Synchronous view of a preloaded secret cache. `mcp-shared-secrets`'
 * `SecretResolver` satisfies it; `cached` throws for a key that was not
 * preloaded or is unset.
 */
export interface CachedSecrets {
  cached(key: string): string;
}

/** `<P>_SSM_*` keys `ssmConfigFromEnv` reads. */
const SSM_KEY_SUFFIXES = [
  "SSM_TARGET",
  "SSM_REGION",
  "SSM_PROFILE",
  "SSM_DOCUMENT_NAME",
  "SSM_READY_TIMEOUT_MS",
] as const;

/** Sync cache lookup that returns undefined instead of throwing for missing keys. */
function tryCached(params: { secrets: CachedSecrets; key: string }): string | undefined {
  try {
    return params.secrets.cached(params.key);
  } catch {
    return undefined;
  }
}

/**
 * Apply the bastion-xor-SSM rule to the two candidate configs.
 */
export function pickTunnelSpec(params: {
  prefix: string;
  bastion: BastionConfig | null;
  ssm: SsmTunnelEnvConfig | null;
}): TunnelSpec | null {
  const { prefix, bastion, ssm } = params;
  if (bastion && ssm) {
    throw new Error(
      `Set at most one of ${prefix}_BASTION_HOST or ${prefix}_SSM_TARGET, not both`,
    );
  }
  if (bastion) return { bastion };
  if (ssm) return { ssm };
  return null;
}

/**
 * Build a `BastionConfig` from the cached `<P>_BASTION_HOST` /
 * `<P>_BASTION_KEY`. `null` when no host is set; the key is optional (e.g.
 * ssh-agent).
 */
export function bastionConfigFromSecrets(params: {
  secrets: CachedSecrets;
  prefix: string;
}): BastionConfig | null {
  const { secrets, prefix } = params;
  const host = tryCached({ secrets, key: `${prefix}_BASTION_HOST` });
  if (host === undefined) return null;
  const identityFile = tryCached({ secrets, key: `${prefix}_BASTION_KEY` });
  return identityFile ? { host, identityFile } : { host };
}

/**
 * Build a `TunnelSpec` from the cached secrets.
 *
 * The cache has already resolved `ssm:` / `sm:` URIs, so values are plain
 * strings here. `ssmConfigFromEnv` reads `process.env`, so cached
 * `<P>_SSM_*` values are mirrored into it first -- only where the env does
 * not already define the key.
 */
export function tunnelConfigFromSecrets(params: {
  secrets: CachedSecrets;
  prefix: string;
}): TunnelSpec | null {
  const { secrets, prefix } = params;
  const bastion = bastionConfigFromSecrets({ secrets, prefix });
  for (const suffix of SSM_KEY_SUFFIXES) {
    const key = `${prefix}_${suffix}`;
    if (process.env[key] !== undefined) continue;
    const cached = tryCached({ secrets, key });
    if (cached !== undefined) process.env[key] = cached;
  }
  return pickTunnelSpec({ prefix, bastion, ssm: ssmConfigFromEnv(prefix) });
}
