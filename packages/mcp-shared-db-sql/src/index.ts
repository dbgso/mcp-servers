// Dialect interface + helpers — engine adapters implement these.
export type {
  Dialect,
  JsonPathInput,
  ParamBuilder,
  DialectExplainResult,
} from "./dialect.js";

// Typed SQL fragments — how a dialect hands back SQL it contributes.
export { asQuotedIdent, ident, RawIdent, SqlFragment, sqlFragment } from "./fragment.js";
export type { QuotedIdent } from "./fragment.js";

// Param accumulator — exposed for adapters that want to use it directly.
export { ParamBuilderImpl } from "./param-builder.js";

// Pure builders — useful for code-gen / introspection paths that want SQL
// without going through the DataSource indirection.
export {
  parseJsonPath,
  buildFindByPk,
  buildFindByEq,
  buildFindByRange,
  buildFindByJsonPath,
} from "./builder.js";
export type {
  BuiltSql,
  BuildFindByPkParams,
  BuildFindByEqParams,
  BuildFindByRangeParams,
  BuildFindByJsonPathParams,
} from "./builder.js";

// Recommended public surface: factory that returns a `DataSource`.
export { createSqlDataSource, SqlDataSource } from "./data-source.js";
export type {
  CreateSqlDataSourceConfig,
  QueryFn,
  QueryFnArgs,
} from "./data-source.js";
