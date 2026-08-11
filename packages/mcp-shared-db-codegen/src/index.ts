// Introspector types and engine implementations
export type {
  Introspector,
  IntrospectTableInput,
  RawTableMetadata,
  RawColumn,
  RawIndex,
  RawForeignKey,
  TableInfo,
} from "./introspect/types.js";
export {
  PostgresIntrospector,
  POSTGRES_QUERIES,
  formatNativeType,
  createPgClient,
  type PgQueryClient,
  type PgQueryResult,
  type PgQueryResultRow,
} from "./introspect/postgres.js";
export { mapPostgresType } from "./introspect/postgres-types.js";
export {
  MysqlIntrospector,
  MYSQL_QUERIES,
  createMysqlClient,
  type MysqlQueryClient,
  type MysqlQueryArgs,
  type MysqlQueryResult,
  type MysqlQueryResultRow,
} from "./introspect/mysql.js";
export { mapMysqlType } from "./introspect/mysql-types.js";
export {
  pickIntrospector,
  type PickIntrospectorParams,
} from "./introspect/pick.js";

// Format functions (JSON-only — TS emitters were removed for node compat)
export { formatMetadataJson } from "./format/metadata-json.js";
export { formatSelectableFieldsJson } from "./format/selectable-fields-json.js";
export { toRdbMetadataMap } from "./format/to-rdb-metadata.js";

// Operations
export type { CodegenOperation, CodegenOperationContext } from "./operations/types.js";
export {
  codegenRegistry,
  allCodegenOperations,
} from "./operations/registry.js";

// Tools factory
export {
  createCodegenTools,
  type CreateCodegenToolsConfig,
} from "./tools-factory.js";
