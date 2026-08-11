// Recommended public surface.
export { createPostgresDataSource } from "./factory.js";
export type { CreatePostgresDataSourceParams } from "./factory.js";

// Dialect — exposed so codegen / tooling that wants raw SQL can reuse it.
export { postgresDialect } from "./dialect.js";

// Lazy `pg.Client` factory + duck-typed shape — useful for callers wiring
// their own pool / custom config.
export { createPgClient } from "./client.js";
export type { PgQueryClient } from "./client.js";
