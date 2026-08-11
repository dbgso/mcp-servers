/**
 * Fake mysql2 connection for unit tests. Routes incoming SQL queries to a
 * registered handler keyed by the exact query string in `MYSQL_QUERIES`,
 * mirroring the PG fixture pattern.
 */
import { vi } from "vitest";
import type {
  MysqlQueryClient,
  MysqlQueryResult,
  MysqlQueryResultRow,
} from "../../introspect/mysql.js";
import { MYSQL_QUERIES } from "../../introspect/mysql.js";

type Handler = (values: unknown[]) => MysqlQueryResult;

export interface FakeMysqlClient extends MysqlQueryClient {
  connect: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  /** Calls captured for assertions: `[sql, values]`. */
  calls: Array<{ sql: string; values: unknown[] }>;
}

export function createFakeMysqlClient(handlers: {
  schemas?: Handler;
  tables?: Handler;
  columns?: Handler;
  primaryKey?: Handler;
  indexes?: Handler;
  foreignKeys?: Handler;
}): FakeMysqlClient {
  const calls: Array<{ sql: string; values: unknown[] }> = [];

  function pickHandler(sql: string): Handler {
    if (sql === MYSQL_QUERIES.schemas && handlers.schemas) return handlers.schemas;
    if (sql === MYSQL_QUERIES.tables && handlers.tables) return handlers.tables;
    if (sql === MYSQL_QUERIES.columns && handlers.columns) return handlers.columns;
    if (sql === MYSQL_QUERIES.primaryKey && handlers.primaryKey) return handlers.primaryKey;
    if (sql === MYSQL_QUERIES.indexes && handlers.indexes) return handlers.indexes;
    if (sql === MYSQL_QUERIES.foreignKeys && handlers.foreignKeys) return handlers.foreignKeys;
    throw new Error(`No fake handler registered for query: ${sql.slice(0, 80)}...`);
  }

  const query = vi.fn(
    async <T extends MysqlQueryResultRow>(args: {
      text: string;
      values?: unknown[];
    }) => {
      calls.push({ sql: args.text, values: args.values ?? [] });
      const handler = pickHandler(args.text);
      return handler(args.values ?? []) as MysqlQueryResult<T>;
    },
  );
  const connect = vi.fn(async () => {});
  const end = vi.fn(async () => {});

  return {
    connect,
    end,
    query: query as unknown as MysqlQueryClient["query"] & ReturnType<typeof vi.fn>,
    calls,
  };
}
