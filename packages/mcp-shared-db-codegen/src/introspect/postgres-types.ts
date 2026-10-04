/**
 * Map Postgres native types to the engine-agnostic `GenericFieldType`.
 *
 * The type table lives in `mcp-shared-db-core`, shared with the validator's
 * native-type classifier.
 */
import { mapNativeType, type GenericFieldType } from "mcp-shared-db-core";

/**
 * Map a Postgres native type to a `GenericFieldType`.
 *
 * Accepts both `data_type` (e.g. `character varying`) and the simpler
 * `udt_name` (e.g. `varchar`) forms. Fallback: anything we don't recognise
 * is treated as string. The caller keeps the native type around so a human
 * can review and fix it later.
 */
export function mapPostgresType(nativeType: string): GenericFieldType {
  return mapNativeType({ nativeType, engine: "postgres" }) ?? "string";
}
