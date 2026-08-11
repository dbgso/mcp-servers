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
import { resolveTunneledUrl } from "mcp-shared/tunnel";
import { createMysqlClient, createMysqlDataSource } from "mcp-shared-db-mysql";
import type { MysqlQueryClient } from "mcp-shared-db-mysql";
import type {
  DetectInsecureTlsArgs,
  EngineConnection,
  EngineStrategy,
  OpenStrategyArgs,
} from "./types.js";

const URL_SCHEME = /^mysql:\/\//i;

/** Default per-statement timeout in milliseconds. */
export const DEFAULT_MAX_EXECUTION_TIME_MS = 10_000;

const SSL_TRUE_RE = /[?&]ssl=true(?:&|$)/i;
const SSL_MODE_RE = /[?&]ssl-?mode=([^&]+)/i;
const ENCRYPTED_SSL_MODE_RE = /^(required|verify-ca|verify-identity|require)$/i;

function buildInsecureWarning(): string {
  return "[db-read-mcp] WARNING: connecting without SSL — append `ssl=true` (or `ssl-mode=required`) to DBREAD_URL when bypassing the SSH bastion.";
}

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
  if (!input) return DEFAULT_MAX_EXECUTION_TIME_MS;
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_MAX_EXECUTION_TIME_MS;
  if (trimmed === "0") return 0;
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|min)?$/i);
  if (!match) return DEFAULT_MAX_EXECUTION_TIME_MS;
  const value = Number(match[1]);
  const unit = (match[2] ?? "ms").toLowerCase();
  if (unit === "ms") return Math.round(value);
  if (unit === "s") return Math.round(value * 1000);
  // unit === "min"
  return Math.round(value * 60_000);
}

export const mysqlStrategy: EngineStrategy = {
  engine: "mysql",

  matches(url: string): boolean {
    return URL_SCHEME.test(url);
  },

  detectInsecureTls(args: DetectInsecureTlsArgs): string | null {
    // Any tunnel (SSH bastion / SSM port forward) encrypts the hop the
    // warning is about, so suppress for both kinds.
    if (args.tunnel) return null;
    if (SSL_TRUE_RE.test(args.url)) return null;
    const mode = args.url.match(SSL_MODE_RE)?.[1];
    if (mode && ENCRYPTED_SSL_MODE_RE.test(mode)) return null;
    return buildInsecureWarning();
  },

  async open(args: OpenStrategyArgs): Promise<EngineConnection> {
    const { url: tunneledUrl, tunnel } = await resolveTunneledUrl({
      url: args.url,
      ...(args.tunnel && { tunnel: args.tunnel }),
    });
    let client: MysqlQueryClient | null = null;
    try {
      client = await createMysqlClient(tunneledUrl);
      await client.connect();
      client.onError((err) => {
        console.error("[db-read-mcp] mysql client error:", err.message);
      });
      const env = args.env ?? process.env;
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
    } catch (err) {
      if (client) await client.end().catch(() => undefined);
      if (tunnel) await tunnel.close().catch(() => undefined);
      throw err;
    }
    const connectedClient = client;
    const dataSource = createMysqlDataSource({
      client: connectedClient,
      tableMetadata: args.tableMetadata,
    });
    return {
      dataSource,
      async close(): Promise<void> {
        await connectedClient.end();
        if (tunnel) await tunnel.close();
      },
    };
  },
};
