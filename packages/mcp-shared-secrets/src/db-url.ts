/**
 * Compose a DB connection URL from per-component env vars, with `<P>_URL`
 * as a fallback.
 *
 * The intended use case: operators store host / port / user / password /
 * database / dialect as separate SSM (or Secrets Manager / env) parameters
 * — common when AWS RDS metadata is published piece-by-piece — instead of
 * a single pre-baked connection URL. Each component flows through the
 * usual `ssm:` / `sm:` / `env:` resolver, so any individual part can be a
 * secret URI without further plumbing.
 *
 * Required parts (all six must be set to opt into "parts" mode):
 *   `<P>_DIALECT` — `"postgres"` (or `"postgresql"`) / `"mysql"`
 *   `<P>_HOST`
 *   `<P>_PORT`
 *   `<P>_USER`
 *   `<P>_PASSWORD`
 *   `<P>_DATABASE`
 *
 * Optional:
 *   `<P>_PARAMS` — extra query string (`"sslmode=require"` or
 *     `"?sslmode=require&application_name=foo"`). Leading `?` is trimmed
 *     for forgiveness.
 *
 * Fallback:
 *   `<P>_URL` — used when one or more required parts are absent.
 *
 * Both forms set: parts win, `<P>_URL` is ignored with a stderr warning so
 * an unintended override isn't silent.
 *
 * Neither form set: throws — caller doesn't need to detect "missing" itself.
 */
import type { SecretResolver } from "./resolver.js";

/** Suffixes appended after the prefix; the full key is `${prefix}_${suffix}`. */
export const DB_URL_PART_SUFFIXES = [
  "DIALECT",
  "HOST",
  "PORT",
  "USER",
  "PASSWORD",
  "DATABASE",
  "PARAMS",
] as const;
export type DbUrlPartSuffix = (typeof DB_URL_PART_SUFFIXES)[number];

/** Suffixes required to enter "parts" mode. PARAMS is optional. */
const REQUIRED_PART_SUFFIXES = [
  "DIALECT",
  "HOST",
  "PORT",
  "USER",
  "PASSWORD",
  "DATABASE",
] as const satisfies readonly DbUrlPartSuffix[];

export interface ComposeDbUrlFromResolverParams {
  resolver: SecretResolver;
  /** Env-var prefix, e.g. `"DBREAD"`. Keys become `${prefix}_DIALECT` etc. */
  prefix: string;
  /**
   * Logger for the "both parts and URL set" warning. Defaults to
   * `console.error`. Tests use it to assert the warning fires.
   */
  warn?: (message: string) => void;
}

export interface ComposedDbUrl {
  /** Final connection URL. */
  url: string;
  /** Which form supplied it — useful for logging / tests. */
  source: "parts" | "url";
}

/**
 * Build a connection URL from the resolver's preloaded cache.
 *
 * Pre-condition: the caller has already invoked
 * `resolver.preload([...keys for this prefix..., `${prefix}_URL`])`. This
 * helper does not perform I/O.
 */
export function composeDbUrlFromResolver(
  params: ComposeDbUrlFromResolverParams,
): ComposedDbUrl {
  const { resolver, prefix } = params;
  const parts = collectParts({ resolver, prefix });
  const urlFallback = tryCached({ resolver, key: `${prefix}_URL` });

  if (hasAllRequired(parts)) {
    const url = buildUrl({
      dialect: parts.DIALECT,
      host: parts.HOST,
      port: parts.PORT,
      user: parts.USER,
      password: parts.PASSWORD,
      database: parts.DATABASE,
      ...(parts.PARAMS !== undefined && { params: parts.PARAMS }),
    });
    if (urlFallback !== undefined) {
      const warn = params.warn ?? ((m) => console.error(m));
      warn(
        `[mcp-shared-secrets] Both ${prefix}_{DIALECT,HOST,PORT,USER,PASSWORD,DATABASE} and ${prefix}_URL are set; using parts and ignoring ${prefix}_URL.`,
      );
    }
    return { url, source: "parts" };
  }

  if (urlFallback !== undefined) {
    return { url: urlFallback, source: "url" };
  }

  throw new Error(
    `Neither ${prefix}_URL nor the ${prefix}_{DIALECT,HOST,PORT,USER,PASSWORD,DATABASE} component set is fully configured.`,
  );
}

type PartsBag = Partial<Record<DbUrlPartSuffix, string>>;
type RequiredParts = Required<
  Pick<PartsBag, (typeof REQUIRED_PART_SUFFIXES)[number]>
> &
  Pick<PartsBag, "PARAMS">;

interface CollectPartsParams {
  resolver: SecretResolver;
  prefix: string;
}

function collectParts(params: CollectPartsParams): PartsBag {
  const out: PartsBag = {};
  for (const suffix of DB_URL_PART_SUFFIXES) {
    const v = tryCached({ resolver: params.resolver, key: `${params.prefix}_${suffix}` });
    if (v !== undefined) out[suffix] = v;
  }
  return out;
}

function hasAllRequired(parts: PartsBag): parts is RequiredParts {
  return REQUIRED_PART_SUFFIXES.every((s) => parts[s] !== undefined);
}

interface BuildUrlArgs {
  dialect: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  params?: string;
}

function buildUrl(args: BuildUrlArgs): string {
  const auth = `${encodeURIComponent(args.user)}:${encodeURIComponent(args.password)}`;
  const path = `/${encodeURIComponent(args.database)}`;
  const normalizedParams = args.params !== undefined ? normalizeParams(args.params) : undefined;
  const query = normalizedParams ? `?${normalizedParams}` : "";
  return `${args.dialect}://${auth}@${args.host}:${args.port}${path}${query}`;
}

/**
 * Trim a leading `?` plus surrounding whitespace from `<P>_PARAMS`, so both
 * `?sslmode=require` and `sslmode=require` produce the same query string.
 * Returns `undefined` for empty / whitespace-only / lone-`?` values so the
 * caller skips the `?` prefix altogether.
 */
function normalizeParams(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const withoutLead = trimmed.startsWith("?") ? trimmed.slice(1).trim() : trimmed;
  return withoutLead || undefined;
}

interface TryCachedParams {
  resolver: SecretResolver;
  key: string;
}

function tryCached(params: TryCachedParams): string | undefined {
  try {
    return params.resolver.cached(params.key);
  } catch {
    return undefined;
  }
}
