/**
 * Pick an `Introspector` implementation from a connection URL.
 *
 * Scheme matching is intentionally loose (`postgres://` and `postgresql://`)
 * because both forms are common in tooling. Future engines (Mongo, DuckDB)
 * can extend this without changing the operation layer.
 */
import type { Introspector } from "./types.js";
import {
  PostgresIntrospector,
  createPgClient,
  type PgQueryClient,
} from "./postgres.js";
import {
  MysqlIntrospector,
  createMysqlClient,
  type MysqlQueryClient,
} from "./mysql.js";

export interface PickIntrospectorParams {
  url: string;
  /**
   * Override the pg client factory. Tests inject a fake here; production
   * defaults to a lazy `pg.Client` built from the URL.
   */
  pgClientFactory?: (url: string) => Promise<PgQueryClient>;
  /**
   * Override the mysql client factory. Tests inject a fake here; production
   * defaults to a lazy mysql2 connection built from the URL.
   */
  mysqlClientFactory?: (url: string) => Promise<MysqlQueryClient>;
}

export async function pickIntrospector(
  params: PickIntrospectorParams,
): Promise<Introspector> {
  const { url } = params;
  if (/^postgres(ql)?:\/\//i.test(url)) {
    const factory = params.pgClientFactory ?? createPgClient;
    const client = await factory(url);
    return new PostgresIntrospector(client);
  }
  if (/^mysql:\/\//i.test(url)) {
    const factory = params.mysqlClientFactory ?? createMysqlClient;
    const client = await factory(url);
    return new MysqlIntrospector(client);
  }
  throw new Error(`Unsupported scheme for codegen: ${url}`);
}
