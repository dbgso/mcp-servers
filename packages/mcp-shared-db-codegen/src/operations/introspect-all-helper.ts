/**
 * Shared helper used by `introspect_all`, `preview_metadata_json`, and
 * `preview_selectable_fields_json`. Resolves a schema + optional filter
 * into a list of `RawTableMetadata`.
 */
import type { Introspector, RawTableMetadata } from "../introspect/types.js";

export interface IntrospectAllParams {
  introspector: Introspector;
  schema: string;
  /** Optional case-insensitive substring to filter table names. */
  tableFilter?: string;
  /** Explicit table names. When given, takes precedence over `tableFilter`. */
  tables?: string[];
}

export async function introspectAllTables(
  params: IntrospectAllParams,
): Promise<RawTableMetadata[]> {
  const { introspector, schema, tableFilter, tables } = params;
  let names: string[];
  if (tables && tables.length > 0) {
    names = tables;
  } else {
    const list = await introspector.listTables(schema);
    if (tableFilter) {
      const needle = tableFilter.toLowerCase();
      names = list.filter((t) => t.name.toLowerCase().includes(needle)).map((t) => t.name);
    } else {
      names = list.map((t) => t.name);
    }
  }
  // Sequential introspection — keeps the load on the connected DB modest
  // when the schema has hundreds of tables.
  const results: RawTableMetadata[] = [];
  for (const name of names) {
    results.push(await introspector.introspectTable({ schema, table: name }));
  }
  return results;
}
