/**
 * Format `RawTableMetadata[]` into a pretty-printed JSON string consumable by
 * `db-read-mcp` as a `metadata.json` file.
 *
 * Why JSON instead of a TS module:
 *   - Distributed binaries are launched with plain `node`, which can't load
 *     `.ts` files. JSON is universal.
 *   - The native DB type (e.g. `varchar(255)`) is preserved on every field via
 *     `nativeType` so a reviewer can sanity-check the GenericFieldType mapping
 *     without re-querying the catalog.
 *
 * Pure function — no I/O, no judgement. The shape mirrors `RdbTableMetadataMap`
 * with `nativeType` added on every field.
 */
import type { RawTableMetadata, RawColumn } from "../introspect/types.js";
import { buildTableMetadata, type TableMetadataWithFields } from "./to-rdb-metadata.js";

interface JsonField {
  type: RawColumn["type"];
  nullable: boolean;
  /** Native DB type kept alongside the generic mapping for human review. */
  nativeType: string;
  description?: string;
}

type JsonTable = TableMetadataWithFields<JsonField>;

function toJsonField(column: RawColumn): JsonField {
  const out: JsonField = {
    type: column.type,
    nullable: column.nullable,
    nativeType: column.nativeType,
  };
  if (column.description) out.description = column.description;
  return out;
}

/**
 * Build a pretty-printed JSON document keyed by table name.
 *
 * Trailing newline is included so the file ends cleanly when written to disk.
 */
export function formatMetadataJson(tables: RawTableMetadata[]): string {
  const out: Record<string, JsonTable> = {};
  for (const t of tables) {
    out[t.name] = buildTableMetadata({ table: t, toField: toJsonField });
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}
