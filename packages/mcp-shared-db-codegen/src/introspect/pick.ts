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

type OpenIntrospector = (params: PickIntrospectorParams) => Promise<Introspector>;

const openPostgres: OpenIntrospector = async (params) => {
  const factory = params.pgClientFactory ?? createPgClient;
  return new PostgresIntrospector(await factory(params.url));
};

const openMysql: OpenIntrospector = async (params) => {
  const factory = params.mysqlClientFactory ?? createMysqlClient;
  return new MysqlIntrospector(await factory(params.url));
};

/** Introspector per URL scheme (lower case, without `://`). */
const OPEN_BY_SCHEME: ReadonlyMap<string, OpenIntrospector> = new Map([
  ["postgres", openPostgres],
  ["postgresql", openPostgres],
  ["mysql", openMysql],
]);

/** The URL's scheme in lower case (`MYSQL://h` -> `mysql`), or "" when it has none. */
function schemeOf(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
  return match ? String(match[1]).toLowerCase() : "";
}

export async function pickIntrospector(
  params: PickIntrospectorParams,
): Promise<Introspector> {
  const open = OPEN_BY_SCHEME.get(schemeOf(params.url));
  if (!open) throw new Error(`Unsupported scheme for codegen: ${params.url}`);
  return open(params);
}
