/**
 * Lazy `mysql2` client factory.
 *
 * `mysql2` is an optional peer dependency, so we import it dynamically —
 * packages that only consume the dialect / SQL builder don't have to install
 * it.
 *
 * URL → connection-options normalisation lives here because `mysql2`'s
 * `createConnection({ uri })` shortcut does not accept every flag the URL
 * form might carry; we parse the URL ourselves so we can:
 *   - force `multipleStatements: false` regardless of URL hints
 *     (`?multipleStatements=true` is silently dropped),
 *   - convert `?ssl=true` (the URL form) into the option object form mysql2
 *     expects (`ssl: {}`),
 *   - keep date/time parsing predictable by setting `dateStrings: false`.
 */

/** Subset of mysql2's connection options we use. */
export interface MysqlConnectionOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  /**
   * **Always `false`**. Setting this to `true` re-enables `;`-separated
   * multi-statement input at the wire, which would expose `explain_sql`
   * (and any future raw-SQL op) to injection. The factory never sets it
   * to `true`; the lock test in `client.test.ts` enforces that even a
   * URL with `?multipleStatements=true` is overridden back to `false`.
   */
  multipleStatements: false;
  /** When set, mysql2 enables TLS using its built-in CA bundle. */
  ssl?: object;
  /** Return JS Date objects (not strings) for DATETIME / TIMESTAMP. */
  dateStrings?: false;
}

/** Args for {@link MysqlQueryClient.query}. */
export interface MysqlQueryArgs {
  text: string;
  values?: unknown[];
}

/** Subset of mysql2's `Connection` we use. Easy to mock in tests. */
export interface MysqlQueryClient {
  /**
   * mysql2's `createConnection` returns an already-active connection; this
   * is a no-op shim to match `PgQueryClient.connect()` so callers can treat
   * both engines identically.
   */
  connect(): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    args: MysqlQueryArgs,
  ): Promise<{ rows: T[] }>;
  end(): Promise<void>;
  /**
   * Subscribe to mysql2's async error channel (server-initiated disconnect,
   * idle-timeout closure, network blip). Without a listener mysql2 surfaces
   * these as unhandled error events on the connection, which can take the
   * host process down mid-request.
   *
   * Single-purpose by design — the only event the adapter cares about is
   * `error`, so the API takes only the listener.
   */
  onError(listener: (err: Error) => void): void;
}

// Duck type for mysql2's `Connection`. Mirrors mysql2's actual positional
// `query(sql, values)` API — wrapConnection adapts to the params-object
// MysqlQueryClient surface below.
interface Mysql2Connection {
  query(text: string, values?: unknown[]): Promise<[unknown, unknown]>;
  end(): Promise<void>;
  on(event: string, listener: (err: Error) => void): void;
}

interface Mysql2Module {
  createConnection?: (
    options: MysqlConnectionOptions,
  ) => Promise<Mysql2Connection>;
  default?: {
    createConnection?: (
      options: MysqlConnectionOptions,
    ) => Promise<Mysql2Connection>;
  };
}

/**
 * Decode a URL component, falling back to the raw value when the input
 * contains an invalid percent-encoding (`%` followed by something other
 * than two hex digits). Matches how DB drivers typically forgive raw
 * special chars in credentials supplied via env files.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Convert a `mysql://` URL into the option object mysql2 expects.
 *
 * Exported (rather than inline) so the URL → option mapping can be unit-
 * tested without going near a real mysql2 module.
 */
export function urlToConnectionOptions(url: string): MysqlConnectionOptions {
  const parsed = new URL(url);
  // Force the load-bearing defence regardless of what the URL says.
  const opts: MysqlConnectionOptions = {
    multipleStatements: false,
    dateStrings: false,
  };
  if (parsed.hostname) opts.host = parsed.hostname;
  if (parsed.port) opts.port = Number(parsed.port);
  if (parsed.username) opts.user = safeDecode(parsed.username);
  if (parsed.password) opts.password = safeDecode(parsed.password);
  // URL pathname starts with '/' — strip it for the database name.
  const pathDb = parsed.pathname.replace(/^\//, "");
  if (pathDb) opts.database = safeDecode(pathDb);
  // mysql2's URL form accepts `?ssl=true` (built-in CA) and `?ssl-mode=...`
  // but the option object only accepts `ssl: {}`. We translate.
  const ssl = parsed.searchParams.get("ssl");
  const sslMode = parsed.searchParams.get("ssl-mode") ?? parsed.searchParams.get("sslmode");
  if (ssl === "true" || (sslMode && /^(required|verify-ca|verify-identity|require)$/i.test(sslMode))) {
    opts.ssl = {};
  }
  return opts;
}

/**
 * Build a mysql2 connection from a connection URL.
 *
 * The URL is parsed into an option object so we can force
 * `multipleStatements: false` even when the URL says otherwise. Caller
 * controls TLS via `?ssl=true` or `?ssl-mode=required`; absent that, the
 * URL → option mapping leaves SSL unset and mysql2 falls back to plain TCP
 * (the engine strategy in db-read-mcp emits a warning when this happens
 * outside an SSH tunnel).
 */
export async function createMysqlClient(url: string): Promise<MysqlQueryClient> {
  const options = urlToConnectionOptions(url);
  // Cast through unknown — mysql2 ships its own .d.ts but we duck-type the
  // narrow subset we use to keep the surface easy to mock.
  const mod = (await import("mysql2/promise" as string)) as unknown as Mysql2Module;
  const create = mod.createConnection ?? mod.default?.createConnection;
  if (!create) {
    throw new Error(
      "mysql2/promise.createConnection is not available — is the 'mysql2' package installed?",
    );
  }
  const conn = await create(options);
  return wrapConnection(conn);
}

/**
 * Adapter: mysql2's `query()` returns `[rows, fields]`; the `QueryFn`
 * contract returns `{ rows }`. Also fakes `connect()` since mysql2 is
 * already connected after `createConnection`.
 */
export function wrapConnection(conn: Mysql2Connection): MysqlQueryClient {
  return {
    async connect(): Promise<void> {
      // No-op: mysql2's createConnection already negotiated the handshake.
    },
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      args: MysqlQueryArgs,
    ): Promise<{ rows: T[] }> {
      const [rows] = await conn.query(args.text, args.values ?? []);
      // For SELECT-shaped statements mysql2 returns `RowDataPacket[]`. For
      // SET / DDL it returns an `OkPacket` (object). The op layer only
      // dispatches SELECT, but defensively unwrap to an empty array when we
      // get a non-array.
      return { rows: Array.isArray(rows) ? (rows as T[]) : [] };
    },
    async end(): Promise<void> {
      await conn.end();
    },
    onError(listener: (err: Error) => void): void {
      conn.on("error", listener);
    },
  };
}
