/**
 * Lazy `pg.Client` factory.
 *
 * `pg` is an optional peer dependency, so we import it dynamically — packages
 * that only consume the dialect / SQL builder don't have to install it. The
 * ESM/CJS interop quirk below mirrors the pattern in
 * `mcp-shared-db-codegen/src/introspect/postgres.ts`.
 */

/**
 * Query config form accepted by pg.Client. We only use it to set
 * `queryMode: 'extended'`, which forces pg-node down the Parse + Bind +
 * Execute path even when `values` is empty — this is what gives us
 * **wire-level multi-statement reject** (PG's Parse message accepts a
 * single statement only). Available in `pg >= 8.11`; the same minimum
 * is pinned in this package's peerDependencies because `queryMode` is
 * the load-bearing defence (see `factory.ts`) — silently regressing
 * to an older pg would re-open multi-statement injection on `explain_sql`.
 */
export interface PgQueryConfig {
  text: string;
  values?: unknown[];
  queryMode?: "extended";
}

/** Minimal subset of `pg.Client` we actually use. Easy to mock. */
export interface PgQueryClient {
  connect(): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    config: PgQueryConfig,
  ): Promise<{ rows: T[] }>;
  end(): Promise<void>;
  /**
   * Subscribe to pg's async error channel (server-initiated disconnect,
   * idle-timeout closure, network blip). Without a listener pg surfaces
   * these as unhandled `'error'` events on the underlying EventEmitter,
   * which can take the host process down mid-request.
   */
  on(event: "error", listener: (err: Error) => void): void;
}

interface PgClientCtor {
  new (cfg: { connectionString: string }): PgQueryClient;
}

interface PgModule {
  Client?: PgClientCtor;
  default?: { Client?: PgClientCtor };
}

/**
 * Build a pg.Client from a connection string.
 *
 * The URL is forwarded verbatim — caller controls TLS. When the connection
 * is **not** going through an SSH bastion (i.e. the read MCP is talking to
 * the DB directly), include `sslmode=require` (or stricter) in the URL or
 * the wire protocol falls back to plain TCP. The bastion path is fine on
 * its own since the SSH tunnel is already encrypted.
 */
export async function createPgClient(url: string): Promise<PgQueryClient> {
  // Cast through unknown — pg ships without bundled types and we don't want
  // to force callers to install @types/pg just to use the adapter.
  const mod = (await import("pg" as string)) as unknown as PgModule;
  const ctor = mod.default?.Client ?? mod.Client;
  if (!ctor) {
    throw new Error("pg.Client is not available — is the 'pg' package installed?");
  }
  return new ctor({ connectionString: url });
}
