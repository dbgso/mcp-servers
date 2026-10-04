/**
 * Postgres engine strategy.
 *
 * - URL scheme: `postgres://` or `postgresql://`.
 * - TLS check: only `sslmode={require,verify-ca,verify-full}` is treated as
 *   "explicitly encrypted" — `disable` / `allow` / `prefer` permit a
 *   plaintext fallback and warn.
 * - Startup config: `statement_timeout` (10s default, override via
 *   `DBREAD_STATEMENT_TIMEOUT`) and `default_transaction_read_only = on`.
 * - DataSource: `createPostgresDataSource` with the pg.Client.
 */
import { createPgClient, createPostgresDataSource } from "mcp-shared-db-postgres";
import type { PgQueryClient } from "mcp-shared-db-postgres";
import type {
  DetectInsecureTlsArgs,
  EngineConnection,
  EngineStrategy,
  OpenStrategyArgs,
} from "./types.js";
import { openSqlConnection, type SqlEngineSteps } from "./engine-connection.js";

const URL_SCHEME = /^postgres(ql)?:\/\//i;

/** Default `statement_timeout` applied at connection time. */
export const DEFAULT_STATEMENT_TIMEOUT = "10s";

const SSLMODE_RE = /[?&]sslmode=([^&]+)/i;
const ENCRYPTED_SSLMODE_RE = /^(require|verify-ca|verify-full)$/i;

function buildInsecureWarning(): string {
  return "[db-read-mcp] WARNING: connecting without SSL — append `sslmode=require` to DBREAD_URL when bypassing the SSH bastion.";
}

export class PostgresStrategy implements EngineStrategy {
  readonly engine = "postgres";

  matches(url: string): boolean {
    return URL_SCHEME.test(url);
  }

  detectInsecureTls(args: DetectInsecureTlsArgs): string | null {
    // Any tunnel (SSH bastion / SSM port forward) encrypts the hop the
    // warning is about, so suppress for both kinds.
    if (args.tunnel) return null;
    const sslmode = args.url.match(SSLMODE_RE)?.[1];
    const explicitlyEncrypted =
      sslmode !== undefined && ENCRYPTED_SSLMODE_RE.test(sslmode);
    return explicitlyEncrypted ? null : buildInsecureWarning();
  }

  open(args: OpenStrategyArgs): Promise<EngineConnection> {
    return openSqlConnection({ args, steps: POSTGRES_STEPS });
  }
}

const POSTGRES_STEPS: SqlEngineSteps<PgQueryClient> = {
  createClient: createPgClient,
  async startSession({ client, env }) {
    await client.connect();
    // pg.Client emits async errors on idle disconnect (RDS ~60min,
    // network blips, server kills). Without a listener the EventEmitter
    // throws and Node tears the process down.
    client.on("error", (err) => {
      console.error("[db-read-mcp] pg client error:", err.message);
    });
    // Treat empty / whitespace-only env values as "unset" so a stray
    // `DBREAD_STATEMENT_TIMEOUT=` in a dotenv file doesn't poison the SET.
    const timeout = env.DBREAD_STATEMENT_TIMEOUT?.trim() || DEFAULT_STATEMENT_TIMEOUT;
    await client.query("SELECT set_config('statement_timeout', $1, false)", [timeout]);
    // `set_config(...)` is a function call, so this stays legal even
    // after `default_transaction_read_only = on` flips on for the
    // session — only INSERT/UPDATE/DELETE would error, and the op layer
    // never emits those.
    await client.query("SELECT set_config('default_transaction_read_only', 'on', false)");
  },
  createDataSource: createPostgresDataSource,
};

export const postgresStrategy = new PostgresStrategy();
