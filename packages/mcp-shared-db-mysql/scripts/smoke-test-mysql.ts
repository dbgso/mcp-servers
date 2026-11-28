/**
 * Live smoke test for createMysqlDataSource + MysqlIntrospector against a
 * real MySQL instance.
 *
 * Usage:
 *   pnpm --filter mcp-shared-db-mysql exec tsx \
 *     scripts/smoke-test-mysql.ts <env-file>
 *
 * The env file must define DBGEN_URL (a `mysql://` URL). Bastion is
 * optional — if DBGEN_BASTION_HOST is set we tunnel through it; otherwise
 * we connect directly.
 *
 * Verifies:
 *   1. mysql2 connection succeeds via createMysqlClient.
 *   2. MysqlIntrospector.listSchemas / listTables / introspectTable run.
 *   3. findByEq / findByPk / findByRange / explainSql against an
 *      auto-detected table from the live schema.
 *   4. findByJsonPath if any json column is found in the introspected meta.
 *
 * What is the same on every engine lives in ci/db/smoke-kit.mts; this file is
 * how to reach MySQL.
 *
 * No PII is printed — only ids, counts, and structural info.
 */
import { createSecretResolver, envSource, loadEnvFile } from "mcp-shared-secrets";
import { resolveTunneledUrl } from "mcp-shared/tunnel";
import {
  MysqlIntrospector,
  createMysqlClient as createIntrospectorMysqlClient,
  type RawColumn,
} from "mcp-shared-db-codegen";
import {
  ClientRuntime,
  runEngineSmokeScript,
  type PickedTable,
  type SmokeEngine,
  type SmokeRuntime,
} from "../../../ci/db/smoke-kit.mjs";
import { createMysqlClient } from "../src/client.js";
import { mysqlDialect } from "../src/dialect.js";
import { createMysqlDataSource } from "../src/factory.js";

class MysqlSmokeEngine implements SmokeEngine<RawColumn> {
  readonly label = "mysql2";

  async openRuntime(url: string): Promise<SmokeRuntime<RawColumn>> {
    const client = await createMysqlClient(url);
    await client.connect();
    client.onError((err) => console.error("[smoke] mysql client error:", err.message));
    return new ClientRuntime<RawColumn>({
      client,
      dataSource: (tableMetadata) => createMysqlDataSource({ client, tableMetadata }),
    });
  }

  async openIntrospector(url: string): Promise<MysqlIntrospector> {
    return new MysqlIntrospector(await createIntrospectorMysqlClient(url));
  }

  /** A MySQL "schema" is a database: the one in the URL path, else the first. */
  pickSchema(params: { url: string; schemas: readonly string[] }): string | undefined {
    return new URL(params.url).pathname.replace(/^\//, "") || params.schemas[0];
  }

  quoteIdent(name: string): string {
    return mysqlDialect.quoteIdent(name);
  }

  /** Unqualified: the connection's database is the schema that was picked. */
  tableRef(picked: PickedTable<RawColumn>): string {
    return this.quoteIdent(picked.name);
  }
}

runEngineSmokeScript({
  script: "smoke-test-mysql.ts",
  engine: new MysqlSmokeEngine(),
  secrets: { loadEnvFile, createSecretResolver, envSource },
  resolveTunneledUrl,
});
