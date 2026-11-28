/**
 * Live smoke test for createPostgresDataSource + PostgresIntrospector against
 * a real Postgres instance.
 *
 * Usage:
 *   pnpm --filter mcp-shared-db-postgres exec tsx \
 *     scripts/smoke-test-postgres.ts <env-file>
 *
 * The env file must define DBGEN_URL (a `postgres://` URL). Bastion is
 * optional — if DBGEN_BASTION_HOST is set we tunnel through it; otherwise
 * we connect directly.
 *
 * Verifies:
 *   1. Connection succeeds via createPgClient (through a tunnel if configured).
 *   2. PostgresIntrospector.listSchemas / listTables / introspectTable run.
 *   3. findByEq / findByPk / findByRange / explainSql against an
 *      auto-detected table from the live schema.
 *   4. findByJsonPath if the picked table has a json/jsonb column.
 *
 * What is the same on every engine lives in ci/db/smoke-kit.mts; this file is
 * how to reach Postgres.
 *
 * No PII is printed — only ids, counts, and structural info.
 */
import { createSecretResolver, envSource, loadEnvFile } from "mcp-shared-secrets";
import { resolveTunneledUrl } from "mcp-shared/tunnel";
import {
  PostgresIntrospector,
  createPgClient as createIntrospectorPgClient,
  type RawColumn,
} from "mcp-shared-db-codegen";
import {
  ClientRuntime,
  runEngineSmokeScript,
  type PickedTable,
  type SmokeEngine,
  type SmokeRuntime,
} from "../../../ci/db/smoke-kit.mjs";
import { createPgClient } from "../src/client.js";
import { postgresDialect } from "../src/dialect.js";
import { createPostgresDataSource } from "../src/factory.js";

class PostgresSmokeEngine implements SmokeEngine<RawColumn> {
  readonly label = "pg";

  async openRuntime(url: string): Promise<SmokeRuntime<RawColumn>> {
    const client = await createPgClient(url);
    // `createPgClient` constructs a pg.Client and stops there, matching what
    // db-read-mcp's strategy does before it connects. Querying an unconnected
    // client does not throw -- pg queues the query against a connection that
    // will never open -- so leaving this out hangs rather than fails.
    await client.connect();
    client.on("error", (err) => console.error("[smoke] pg client error:", err.message));
    return new ClientRuntime<RawColumn>({
      client,
      dataSource: (tableMetadata) => createPostgresDataSource({ client, tableMetadata }),
    });
  }

  async openIntrospector(url: string): Promise<PostgresIntrospector> {
    return new PostgresIntrospector(await createIntrospectorPgClient(url));
  }

  /** The schema named in the URL, else `public`, else the first one listed. */
  pickSchema(params: { url: string; schemas: readonly string[] }): string | undefined {
    const named = new URL(params.url).searchParams.get("schema");
    return named ?? params.schemas.find((s) => s === "public") ?? params.schemas[0];
  }

  quoteIdent(name: string): string {
    return postgresDialect.quoteIdent(name);
  }

  tableRef(picked: PickedTable<RawColumn>): string {
    return `${this.quoteIdent(picked.schema)}.${this.quoteIdent(picked.name)}`;
  }
}

runEngineSmokeScript({
  script: "smoke-test-postgres.ts",
  engine: new PostgresSmokeEngine(),
  secrets: { loadEnvFile, createSecretResolver, envSource },
  resolveTunneledUrl,
});
