/**
 * MySQL engine strategy.
 *
 * - URL scheme: `mysql://`.
 * - TLS check: `?ssl=true` or `?ssl-mode={required,verify-ca,verify-identity,
 *   require}` (also tolerates `?sslmode=...` for forgiveness) counts as
 *   "explicitly encrypted". Anything else, including absent SSL, warns.
 * - Startup config: `SET SESSION max_execution_time = <ms>` (default 10000
 *   = 10s, override via `DBREAD_STATEMENT_TIMEOUT`) and
 *   `SET SESSION transaction_read_only = 1`.
 * - DataSource: `createMysqlDataSource` with the mysql2 connection.
 *
 * Multi-statement defence is on the connection options
 * (`multipleStatements: false`) — see `mcp-shared-db-mysql/src/client.ts`.
 */
import { createMysqlClient, createMysqlDataSource } from "mcp-shared-db-mysql";
import type { MysqlQueryClient } from "mcp-shared-db-mysql";
import type {
  DetectInsecureTlsArgs,
  EngineConnection,
  EngineStrategy,
  OpenStrategyArgs,
} from "./types.js";
import { openSqlConnection, type SqlEngineSteps } from "./engine-connection.js";

const URL_SCHEME = /^mysql:\/\//i;

/** Default per-statement timeout in milliseconds. */
export const DEFAULT_MAX_EXECUTION_TIME_MS = 10_000;

const SSL_TRUE_RE = /[?&]ssl=true(?:&|$)/i;
const SSL_MODE_RE = /[?&]ssl-?mode=([^&]+)/i;
const ENCRYPTED_SSL_MODE_RE = /^(required|verify-ca|verify-identity|require)$/i;

function buildInsecureWarning(): string {
  return "[db-read-mcp] WARNING: connecting without SSL — append `ssl=true` (or `ssl-mode=required`) to DBREAD_URL when bypassing the SSH bastion.";
}

type TimeoutUnit = "ms" | "s" | "min";

/** Milliseconds per unit of a `DBREAD_STATEMENT_TIMEOUT` duration. */
const MS_PER_UNIT: Record<TimeoutUnit, number> = { ms: 1, s: 1000, min: 60_000 };

const TIMEOUT_RE = /^(\d+(?:\.\d+)?)(ms|s|min)?$/i;

/**
 * Parse `DBREAD_STATEMENT_TIMEOUT` into a MySQL `max_execution_time`
 * milliseconds value. Accepts:
 *   - `"10s"` / `"500ms"` / `"5min"` (Postgres-style duration string)
 *   - bare number (interpreted as **milliseconds** for parity with PG's
 *     `statement_timeout` integer form)
 *   - `"0"` to disable
 * Anything unparseable falls back to the default.
 *
 * Exported for unit-testing.
 */
export function parseTimeoutMs(input: string | undefined): number {
  const trimmed = input?.trim();
  if (!trimmed) return DEFAULT_MAX_EXECUTION_TIME_MS;
  const match = TIMEOUT_RE.exec(trimmed);
  if (!match) return DEFAULT_MAX_EXECUTION_TIME_MS;
  const unit = (match[2] ?? "ms").toLowerCase() as TimeoutUnit;
  return Math.round(Number(match[1]) * MS_PER_UNIT[unit]);
}

export class MysqlStrategy implements EngineStrategy {
  readonly engine = "mysql";

  matches(url: string): boolean {
    return URL_SCHEME.test(url);
  }

  detectInsecureTls(args: DetectInsecureTlsArgs): string | null {
    // Any tunnel (SSH bastion / SSM port forward) encrypts the hop the
    // warning is about, so suppress for both kinds.
    if (args.tunnel) return null;
    if (SSL_TRUE_RE.test(args.url)) return null;
    const mode = args.url.match(SSL_MODE_RE)?.[1];
    if (mode && ENCRYPTED_SSL_MODE_RE.test(mode)) return null;
    return buildInsecureWarning();
  }

  open(args: OpenStrategyArgs): Promise<EngineConnection> {
    return openSqlConnection({ args, steps: MYSQL_STEPS });
  }
}

const MYSQL_STEPS: SqlEngineSteps<MysqlQueryClient> = {
  createClient: createMysqlClient,
  async startSession({ client, env }) {
    await client.connect();
    client.onError((err) => {
      console.error("[db-read-mcp] mysql client error:", err.message);
    });
    const timeoutMs = parseTimeoutMs(env.DBREAD_STATEMENT_TIMEOUT);
    // max_execution_time is integer ms; bind it parametrically so the
    // `SET` statement stays a single token (multi-statement is already
    // wire-rejected, but this keeps the SQL boring).
    await client.query({
      text: "SET SESSION max_execution_time = ?",
      values: [timeoutMs],
    });
    await client.query({
      text: "SET SESSION transaction_read_only = 1",
    });
  },
  createDataSource: createMysqlDataSource,
};

export const mysqlStrategy = new MysqlStrategy();
