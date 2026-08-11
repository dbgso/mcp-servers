/**
 * Fake `pg.Client` for unit tests. Routes incoming SQL queries to a
 * registered handler keyed by the query's normalized first ~200 chars.
 *
 * The router is deliberately keyed on the SQL the introspector sends so
 * tests can assert "this query was actually issued" without brittle string
 * matching against the entire SQL body.
 */
import { vi } from "vitest";
import type {
  PgQueryClient,
  PgQueryResult,
  PgQueryResultRow,
} from "../../introspect/postgres.js";
import { POSTGRES_QUERIES } from "../../introspect/postgres.js";

type Handler = (values: unknown[]) => PgQueryResult;

export interface FakePgClient extends PgQueryClient {
  connect: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  /** Calls captured for assertions: `[sql, values]`. */
  calls: Array<{ sql: string; values: unknown[] }>;
}

/**
 * Build a fake client with handlers keyed by query name (matches
 * `POSTGRES_QUERIES`).
 */
export function createFakePgClient(handlers: {
  schemas?: Handler;
  tables?: Handler;
  columns?: Handler;
  primaryKey?: Handler;
  indexes?: Handler;
  foreignKeys?: Handler;
}): FakePgClient {
  const calls: Array<{ sql: string; values: unknown[] }> = [];

  function pickHandler(sql: string): Handler {
    if (sql === POSTGRES_QUERIES.schemas && handlers.schemas) return handlers.schemas;
    if (sql === POSTGRES_QUERIES.tables && handlers.tables) return handlers.tables;
    if (sql === POSTGRES_QUERIES.columns && handlers.columns) return handlers.columns;
    if (sql === POSTGRES_QUERIES.primaryKey && handlers.primaryKey) return handlers.primaryKey;
    if (sql === POSTGRES_QUERIES.indexes && handlers.indexes) return handlers.indexes;
    if (sql === POSTGRES_QUERIES.foreignKeys && handlers.foreignKeys) return handlers.foreignKeys;
    throw new Error(`No fake handler registered for query: ${sql.slice(0, 80)}...`);
  }

  const query = vi.fn(
    async <T extends PgQueryResultRow>(sql: string, values?: unknown[]) => {
      calls.push({ sql, values: values ?? [] });
      const handler = pickHandler(sql);
      return handler(values ?? []) as PgQueryResult<T>;
    },
  );
  const connect = vi.fn(async () => {});
  const end = vi.fn(async () => {});

  return {
    connect,
    end,
    query: query as unknown as PgQueryClient["query"] & ReturnType<typeof vi.fn>,
    calls,
  };
}
