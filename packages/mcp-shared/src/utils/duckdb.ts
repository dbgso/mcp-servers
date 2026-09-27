/**
 * DuckDB utility for in-memory SQL aggregation and file queries.
 */

import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";
import path from "node:path";

export interface CountByFieldResult {
  value: string;
  count: number;
}

/**
 * Infer DuckDB column type from a sample value.
 * Numbers -> DOUBLE, everything else -> VARCHAR.
 */
function inferColumnType(value: unknown): string {
  return typeof value === "number" ? "DOUBLE" : "VARCHAR";
}

/**
 * Escape a SQL string value (single quotes).
 */
function escapeSqlValue(v: unknown): string {
  if (typeof v === "number") return String(v);
  const s = String(v ?? "");
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * The sample the table's column types are inferred from. An empty set of records
 * still has to produce a table, so "no sample" has to mean "no columns" rather
 * than an error.
 */
function firstRecordOf(records: Record<string, unknown>[]): Record<string, unknown> {
  return records[0] ?? {};
}

/**
 * Create a DuckDB in-memory connection, populate an "entries" table from records,
 * and return the connection. Caller is responsible for cleanup.
 */
async function createAndPopulate(params: {
  records: Record<string, unknown>[];
  columns?: string[];
}): Promise<{ connection: DuckDBConnection; columns: string[] }> {
  const { records } = params;
  const firstRecord = firstRecordOf(records);
  const columns = params.columns ?? Object.keys(firstRecord);
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  const colDefs = columns.map((c) => `"${c}" ${inferColumnType(firstRecord[c])}`).join(", ");
  await connection.run(`CREATE TABLE entries (${colDefs})`);

  for (const record of records) {
    const values = columns.map((c) => escapeSqlValue(record[c]));
    await connection.run(`INSERT INTO entries VALUES (${values.join(", ")})`);
  }

  return { connection, columns };
}

/**
 * Count records grouped by a field using DuckDB in-memory SQL.
 */
export async function countByField(params: {
  records: Record<string, unknown>[];
  groupBy: string;
  topN?: number;
}): Promise<CountByFieldResult[]> {
  const { records, groupBy, topN = 20 } = params;
  if (records.length === 0) return [];

  const { connection } = await createAndPopulate({ records });

  const reader = await connection.runAndReadAll(
    `SELECT CAST("${groupBy}" AS VARCHAR) AS value, COUNT(*) AS count FROM entries GROUP BY "${groupBy}" ORDER BY count DESC LIMIT ${Number(topN)}`,
  );
  const rows = reader.getRowObjectsJson() as Record<string, unknown>[];

  return rows.map((row: Record<string, unknown>) => ({
    value: String(row.value),
    count: Number(row.count),
  }));
}

/**
 * Run arbitrary SQL against an in-memory "entries" table populated from records.
 * The SQL must reference the table as "entries".
 */
export async function queryRecords(params: {
  records: Record<string, unknown>[];
  sql: string;
  columns?: string[];
}): Promise<Record<string, unknown>[]> {
  const { records, sql, columns } = params;
  if (records.length === 0) return [];

  const { connection } = await createAndPopulate({
    records,
    ...(columns ? { columns } : {}),
  });

  const reader = await connection.runAndReadAll(sql);
  const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
  return rows;
}

// --- Helpers ---

function convertBigInts(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[key] = typeof value === "bigint" ? Number(value) : value;
  }
  return result;
}

/**
 * Sanitize DuckDB error messages to remove raw data lines.
 * DuckDB CSV parse errors include "Original Line:" with actual file content,
 * which may contain PII (phone numbers, names, etc.).
 */
export function sanitizeDuckDBError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const sanitized = msg
    .replace(
      /Original Line:\s*\n[\s\S]*?(?=\n\n|\nInvalid|\nPossible|\nfile =|$)/g,
      "Original Line: [redacted]",
    )
    .replace(/LINE \d+:.*$/gm, "LINE [redacted]");
  return sanitized;
}

// --- File-based query utilities ---

const EXTENSION_READ_FUNCTIONS: Record<string, string> = {
  ".csv": "read_csv_auto",
  ".tsv": "read_csv_auto",
  ".json": "read_json_auto",
  ".jsonl": "read_json_auto",
  ".parquet": "read_parquet",
};

const SUPPORTED_EXTENSIONS = Object.keys(EXTENSION_READ_FUNCTIONS);

export function getReadFunction(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const fn = EXTENSION_READ_FUNCTIONS[ext];
  if (!fn) {
    throw new Error(
      `Unsupported file extension: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`,
    );
  }
  return fn;
}

export interface ReadOptions {
  encoding?: string;
}

export interface FileAlias {
  path: string;
  alias: string;
  encoding?: string | undefined;
}

export interface ColumnInfo {
  name: string;
  type: string;
}

/** `encoding` is the only read option callers can set; absent means DuckDB's default. */
function readOptionsFor(encoding: string | undefined): ReadOptions | undefined {
  if (!encoding) return undefined;
  return { encoding };
}

function readOptionParts(options: ReadOptions | undefined): string[] {
  if (!options?.encoding) return [];
  return [`encoding='${options.encoding}'`];
}

function buildReadExpr(params: { filePath: string; options?: ReadOptions | undefined }): string {
  const { filePath, options } = params;
  const readFn = getReadFunction(filePath);
  const escaped = filePath.replace(/'/g, "''");
  const opts = readOptionParts(options);
  const optStr = opts.length > 0 ? `, ${opts.join(", ")}` : "";
  return `${readFn}('${escaped}'${optStr})`;
}

/** DuckDB returns COUNT(*) as a single row; an empty reader means nothing matched. */
function countOf(rows: Record<string, unknown>[]): number {
  return Number(rows[0]?.cnt ?? 0);
}

function buildCopyOptions(outputPath: string): string {
  const ext = path.extname(outputPath).toLowerCase();
  switch (ext) {
    case ".csv":
      return "(FORMAT CSV, HEADER)";
    case ".tsv":
      return "(FORMAT CSV, HEADER, DELIMITER '\t')";
    case ".json":
      return "(FORMAT JSON)";
    case ".parquet":
      return "(FORMAT PARQUET)";
    default:
      return "(FORMAT CSV, HEADER)";
  }
}

/** A query needs something to read: a single path, or at least one aliased file. */
function requireSource(params: { filePath: string | undefined; files: FileAlias[] }): void {
  const { filePath, files } = params;
  if (!filePath && files.length === 0) {
    throw new Error("Either filePath or files must be provided");
  }
}

async function registerFileViews(params: {
  connection: DuckDBConnection;
  files: FileAlias[];
  fallback: ReadOptions | undefined;
}): Promise<void> {
  const { connection, files, fallback } = params;
  for (const file of files) {
    // A per-file encoding wins over the query-wide one.
    const options = readOptionsFor(file.encoding) ?? fallback;
    const expr = buildReadExpr({ filePath: file.path, options });
    await connection.run(`CREATE VIEW "${file.alias}" AS SELECT * FROM ${expr}`);
  }
}

async function registerSingleView(params: {
  connection: DuckDBConnection;
  filePath: string | undefined;
  options: ReadOptions | undefined;
}): Promise<void> {
  const { connection, filePath, options } = params;
  // `requireSource` has already established there is one; this satisfies the type.
  if (!filePath) return;
  const expr = buildReadExpr({ filePath, options });
  await connection.run(`CREATE VIEW data AS SELECT * FROM ${expr}`);
}

/**
 * A `files` list wins over `filePath`: the aliases are what the SQL refers to,
 * so registering `data` as well would be dead weight.
 */
async function registerViews(params: {
  connection: DuckDBConnection;
  filePath: string | undefined;
  files: FileAlias[];
  options: ReadOptions | undefined;
}): Promise<void> {
  const { connection, filePath, files, options } = params;
  if (files.length > 0) {
    await registerFileViews({ connection, files, fallback: options });
    return;
  }
  await registerSingleView({ connection, filePath, options });
}

/**
 * Writes the result to a file instead of returning it. COPY does not report how
 * many rows it wrote, so the count is a second query over the same SQL.
 */
async function copyQueryToFile(params: {
  connection: DuckDBConnection;
  sql: string;
  outputPath: string;
}): Promise<{ rows: Record<string, unknown>[]; rowCount: number; outputPath: string }> {
  const { connection, sql, outputPath } = params;
  const escaped = outputPath.replace(/'/g, "''");
  const copyOpts = buildCopyOptions(outputPath);
  await connection.run(`COPY (SELECT * FROM (${sql}) AS _q) TO '${escaped}' ${copyOpts}`);

  const countReader = await connection.runAndReadAll(`SELECT COUNT(*) AS cnt FROM (${sql}) AS _q`);
  const countRows = countReader.getRowObjectsJson() as Record<string, unknown>[];

  return { rows: [], rowCount: countOf(countRows), outputPath };
}

async function selectRows(params: {
  connection: DuckDBConnection;
  sql: string;
  limit?: number;
}): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const { connection, sql, limit = 100 } = params;
  const reader = await connection.runAndReadAll(
    `SELECT * FROM (${sql}) AS _q LIMIT ${Number(limit)}`,
  );
  const rawRows = reader.getRowObjectsJson() as Record<string, unknown>[];
  const rows = rawRows.map(convertBigInts);
  return { rows, rowCount: rows.length };
}

export async function queryFile(params: {
  filePath?: string;
  files?: FileAlias[];
  sql: string;
  limit?: number;
  encoding?: string;
  outputPath?: string;
}): Promise<{ rows: Record<string, unknown>[]; rowCount: number; outputPath?: string }> {
  const { filePath, sql, limit, encoding, outputPath } = params;
  const files = params.files ?? [];
  requireSource({ filePath, files });

  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await registerViews({ connection, filePath, files, options: readOptionsFor(encoding) });

  if (outputPath) {
    return copyQueryToFile({ connection, sql, outputPath });
  }
  return selectRows({ connection, sql, limit });
}

const FORMAT_BY_EXTENSION: Record<string, string> = {
  ".csv": "csv",
  ".tsv": "tsv",
  ".json": "json",
  ".jsonl": "jsonl",
  ".parquet": "parquet",
};

export async function describeFile(params: { filePath: string; encoding?: string }): Promise<{
  columns: ColumnInfo[];
  rowCount: number;
  format: string;
}> {
  const { filePath, encoding } = params;
  const expr = buildReadExpr({ filePath, options: readOptionsFor(encoding) });
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  const descReader = await connection.runAndReadAll(`DESCRIBE SELECT * FROM ${expr}`);
  const descRows = descReader.getRowObjectsJson() as Record<string, unknown>[];
  const columns: ColumnInfo[] = descRows.map((r: Record<string, unknown>) => ({
    name: String(r.column_name),
    type: String(r.column_type),
  }));

  const countReader = await connection.runAndReadAll(`SELECT COUNT(*) AS cnt FROM ${expr}`);
  const countRows = countReader.getRowObjectsJson() as Record<string, unknown>[];

  const ext = path.extname(filePath).toLowerCase();
  return { columns, rowCount: countOf(countRows), format: FORMAT_BY_EXTENSION[ext] ?? ext };
}
