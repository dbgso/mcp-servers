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
 * Create a DuckDB in-memory connection, populate an "entries" table from records,
 * and return the connection. Caller is responsible for cleanup.
 */
async function createAndPopulate(params: {
  records: Record<string, unknown>[];
  columns?: string[];
}): Promise<{ connection: DuckDBConnection; columns: string[] }> {
  const { records } = params;
  const columns = params.columns ?? Object.keys(records[0] ?? {});
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  const firstRecord = records[0] ?? {};
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

function buildReadExpr(params: { filePath: string; options?: ReadOptions }): string {
  const { filePath, options } = params;
  const readFn = getReadFunction(filePath);
  const escaped = filePath.replace(/'/g, "''");
  const opts: string[] = [];
  if (options?.encoding) {
    opts.push(`encoding='${options.encoding}'`);
  }
  const optStr = opts.length > 0 ? `, ${opts.join(", ")}` : "";
  return `${readFn}('${escaped}'${optStr})`;
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

export async function queryFile(params: {
  filePath?: string;
  files?: FileAlias[];
  sql: string;
  limit?: number;
  encoding?: string;
  outputPath?: string;
}): Promise<{ rows: Record<string, unknown>[]; rowCount: number; outputPath?: string }> {
  const { filePath, files, sql, limit = 100, encoding, outputPath } = params;
  const opts: ReadOptions | undefined = encoding ? { encoding } : undefined;

  if (!filePath && (!files || files.length === 0)) {
    throw new Error("Either filePath or files must be provided");
  }

  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  if (files && files.length > 0) {
    for (const file of files) {
      const fileOpts: ReadOptions | undefined = file.encoding ? { encoding: file.encoding } : opts;
      const expr = buildReadExpr({
        filePath: file.path,
        ...(fileOpts && { options: fileOpts }),
      });
      await connection.run(`CREATE VIEW "${file.alias}" AS SELECT * FROM ${expr}`);
    }
  } else if (filePath) {
    const expr = buildReadExpr({
      filePath,
      ...(opts && { options: opts }),
    });
    await connection.run(`CREATE VIEW data AS SELECT * FROM ${expr}`);
  }

  if (outputPath) {
    const escaped = outputPath.replace(/'/g, "''");
    const copyOpts = buildCopyOptions(outputPath);
    const copySQL = `COPY (SELECT * FROM (${sql}) AS _q) TO '${escaped}' ${copyOpts}`;
    await connection.run(copySQL);

    const countReader = await connection.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM (${sql}) AS _q`,
    );
    const countRows = countReader.getRowObjectsJson() as Record<string, unknown>[];
    const rowCount = Number(countRows[0]?.cnt ?? 0);

    return { rows: [], rowCount, outputPath };
  }

  const reader = await connection.runAndReadAll(
    `SELECT * FROM (${sql}) AS _q LIMIT ${Number(limit)}`,
  );
  const rawRows = reader.getRowObjectsJson() as Record<string, unknown>[];
  const rows = rawRows.map(convertBigInts);
  return { rows, rowCount: rows.length };
}

export async function describeFile(params: { filePath: string; encoding?: string }): Promise<{
  columns: ColumnInfo[];
  rowCount: number;
  format: string;
}> {
  const { filePath, encoding } = params;
  const opts: ReadOptions | undefined = encoding ? { encoding } : undefined;
  const expr = buildReadExpr({
    filePath,
    ...(opts && { options: opts }),
  });
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
  const rowCount = Number(countRows[0]?.cnt ?? 0);

  const ext = path.extname(filePath).toLowerCase();
  const formatMap: Record<string, string> = {
    ".csv": "csv",
    ".tsv": "tsv",
    ".json": "json",
    ".jsonl": "jsonl",
    ".parquet": "parquet",
  };

  return { columns, rowCount, format: formatMap[ext] ?? ext };
}
