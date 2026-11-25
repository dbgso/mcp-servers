/**
 * Pure SQL builder functions for the four DataSource read ops.
 *
 * Each function is engine-agnostic: it takes a `Dialect` plus the runtime
 * arguments and returns `{ sql, values }`. No I/O, no caching, no allocation
 * beyond the per-call `ParamBuilderImpl`.
 *
 * The operations layer normalises the JSON path (always `$` or `$.…`)
 * before it reaches us, so `parseJsonPath` only needs to drop the leading
 * sentinel and split on `.`.
 */
import type { Dialect, JsonPathFragment, JsonPathInput, ParamBuilder } from "./dialect.js";
import { ParamBuilderImpl } from "./param-builder.js";

export interface BuiltSql {
  sql: string;
  values: unknown[];
}

/**
 * Strip the operations-layer `$`/`$.` sentinel and split the rest on `.`.
 * Empty segments produced by malformed paths (`"$.a..b"`) are dropped — the
 * upstream normaliser shouldn't emit them, but a defensive filter keeps the
 * builder robust.
 */
export function parseJsonPath(raw: string): JsonPathInput {
  const stripped = raw.replace(/^\$\.?/, "");
  const segments = stripped === "" ? [] : stripped.split(".").filter(Boolean);
  return { raw, segments };
}

function quoteColumns(params: { dialect: Dialect; columns: string[] }): string {
  const { dialect, columns } = params;
  return columns.map((c) => dialect.quoteIdent(c)).join(", ");
}

export interface BuildFindByPkParams {
  dialect: Dialect;
  table: string;
  pkColumn: string;
  pk: unknown;
  columns: string[];
}

export function buildFindByPk(params: BuildFindByPkParams): BuiltSql {
  const pb = new ParamBuilderImpl(params.dialect);
  const colsSql = quoteColumns({ dialect: params.dialect, columns: params.columns });
  const tableSql = params.dialect.quoteIdent(params.table);
  const pkColSql = params.dialect.quoteIdent(params.pkColumn);
  const pkPh = pb.add(params.pk);
  return {
    sql: `SELECT ${colsSql} FROM ${tableSql} WHERE ${pkColSql} = ${pkPh} LIMIT 1`,
    values: pb.build(),
  };
}

export interface BuildFindByEqParams {
  dialect: Dialect;
  table: string;
  field: string;
  value: unknown;
  columns: string[];
  limit: number;
}

export function buildFindByEq(params: BuildFindByEqParams): BuiltSql {
  const pb = new ParamBuilderImpl(params.dialect);
  const colsSql = quoteColumns({ dialect: params.dialect, columns: params.columns });
  const tableSql = params.dialect.quoteIdent(params.table);
  const fieldSql = params.dialect.quoteIdent(params.field);
  const valuePh = pb.add(params.value);
  const limitPh = pb.add(params.limit);
  return {
    sql: `SELECT ${colsSql} FROM ${tableSql} WHERE ${fieldSql} = ${valuePh} LIMIT ${limitPh}`,
    values: pb.build(),
  };
}

export interface BuildFindByRangeParams {
  dialect: Dialect;
  table: string;
  field: string;
  from: unknown;
  to: unknown;
  columns: string[];
  limit: number;
}

export function buildFindByRange(params: BuildFindByRangeParams): BuiltSql {
  const pb = new ParamBuilderImpl(params.dialect);
  const colsSql = quoteColumns({ dialect: params.dialect, columns: params.columns });
  const tableSql = params.dialect.quoteIdent(params.table);
  const fieldSql = params.dialect.quoteIdent(params.field);
  const fromPh = pb.add(params.from);
  const toPh = pb.add(params.to);
  const limitPh = pb.add(params.limit);
  return {
    sql: `SELECT ${colsSql} FROM ${tableSql} WHERE ${fieldSql} BETWEEN ${fromPh} AND ${toPh} LIMIT ${limitPh}`,
    values: pb.build(),
  };
}

export interface BuildFindByJsonPathParams {
  dialect: Dialect;
  table: string;
  field: string;
  path: string;
  value: unknown;
  columns: string[];
  limit: number;
}

/**
 * Join a dialect's SQL parts and values alternately, allocating a placeholder
 * for each value as it is reached.
 */
function interleave(input: { fragment: JsonPathFragment; params: ParamBuilder }): string {
  const { sql, values } = input.fragment;
  if (sql.length !== values.length + 1) {
    throw new Error(
      `dialect returned ${sql.length} SQL parts for ${values.length} values; expected ${values.length + 1}`,
    );
  }
  let out = sql[0] ?? "";
  for (const [i, value] of values.entries()) {
    out += input.params.add(value) + (sql[i + 1] ?? "");
  }
  return out;
}

export function buildFindByJsonPath(params: BuildFindByJsonPathParams): BuiltSql {
  const pb = new ParamBuilderImpl(params.dialect);
  const colsSql = quoteColumns({ dialect: params.dialect, columns: params.columns });
  const tableSql = params.dialect.quoteIdent(params.table);
  const fieldSql = params.dialect.quoteIdent(params.field);
  const path = parseJsonPath(params.path);
  // The dialect hands back literal SQL and the values to bind; the
  // placeholders are made here, walking the two in step. That is what makes
  // the binding order and the textual order the same fact rather than two
  // facts that have to agree — the bug this replaced was them disagreeing.
  const condition = interleave({
    fragment: params.dialect.jsonPathEquals({
      columnSql: fieldSql,
      path,
      value: params.value,
    }),
    params: pb,
  });
  const limitPh = pb.add(params.limit);
  return {
    sql: `SELECT ${colsSql} FROM ${tableSql} WHERE ${condition} LIMIT ${limitPh}`,
    values: pb.build(),
  };
}
