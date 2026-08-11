import { createOperationRegistry, type Operation } from "mcp-shared";
import { listTablesOp, describeTableOp } from "mcp-shared-db-core";
import type { DatabaseOperation, DatabaseOperationContext } from "./types.js";
import { getByPkOp } from "./get-by-pk.js";
import { getByFkOp } from "./get-by-fk.js";
import { getByIndexOp } from "./get-by-index.js";
import { getByDateRangeOp } from "./get-by-date-range.js";
import { jsonSearchOp } from "./json-search.js";
import { explainSqlOp } from "./explain-sql.js";

/**
 * The full RDB operation set: core discovery ops (list_tables, describe_table)
 * + RDB-specific read ops. Core ops use `DatabaseCoreContext` which
 * `DatabaseOperationContext` extends, so they slot in here unchanged.
 */
export const allDatabaseOperations: DatabaseOperation[] = [
  listTablesOp as DatabaseOperation,
  describeTableOp as DatabaseOperation,
  getByPkOp as DatabaseOperation,
  getByFkOp as DatabaseOperation,
  getByIndexOp as DatabaseOperation,
  getByDateRangeOp as DatabaseOperation,
  jsonSearchOp as DatabaseOperation,
  explainSqlOp as DatabaseOperation,
];

export const databaseRegistry = createOperationRegistry<DatabaseOperationContext>(
  allDatabaseOperations as Operation<unknown, DatabaseOperationContext>[],
);
