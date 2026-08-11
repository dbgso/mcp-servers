// Recommended public surface.
export { createMysqlDataSource } from "./factory.js";
export type { CreateMysqlDataSourceParams } from "./factory.js";

// Dialect — exposed so codegen / tooling that wants raw SQL can reuse it.
export { mysqlDialect } from "./dialect.js";

// Lazy `mysql2` client factory + duck-typed shape — useful for callers wiring
// their own pool / custom config.
export { createMysqlClient } from "./client.js";
export type {
  MysqlQueryClient,
  MysqlQueryArgs,
  MysqlConnectionOptions,
} from "./client.js";
