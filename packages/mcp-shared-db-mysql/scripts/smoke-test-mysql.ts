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
 * No PII is printed — only ids, counts, and structural info.
 */
import { loadEnvFile, createSecretResolver, envSource } from "mcp-shared-secrets";
import { resolveTunneledUrl, type BastionConfig } from "mcp-shared/tunnel";
import {
  MysqlIntrospector,
  createMysqlClient as createIntrospectorMysqlClient,
} from "mcp-shared-db-codegen";
import type { RdbTableMetadataMap } from "mcp-shared-db-core";
import { createMysqlClient } from "../src/client.js";
import { createMysqlDataSource } from "../src/factory.js";

interface Args {
  envFile: string;
}

function parseArgs(): Args {
  const envFile = process.argv[2];
  if (!envFile) {
    throw new Error("Usage: tsx scripts/smoke-test-mysql.ts <env-file>");
  }
  return { envFile };
}

interface ResolvedEnv {
  url: string;
  bastion: BastionConfig | null;
}

async function loadResolvedEnv(envFile: string): Promise<ResolvedEnv> {
  loadEnvFile(envFile);
  const resolver = createSecretResolver({ schemes: { env: envSource() } });
  const keys = ["DBGEN_URL", "DBGEN_BASTION_HOST", "DBGEN_BASTION_KEY"] as const;
  await resolver.preload([...keys]);
  const url = resolver.cached("DBGEN_URL");
  // Bastion is optional. Use a tryCached pattern so missing keys don't throw.
  const bastion = ((): BastionConfig | null => {
    try {
      const host = resolver.cached("DBGEN_BASTION_HOST");
      try {
        const identityFile = resolver.cached("DBGEN_BASTION_KEY");
        return { host, identityFile };
      } catch {
        return { host };
      }
    } catch {
      return null;
    }
  })();
  return { url, bastion };
}

interface PickedTable {
  schema: string;
  name: string;
  meta: RdbTableMetadataMap;
  pkColumn: string;
  scalarColumn: string;
  scalarValue: unknown;
  rangeColumn: string | null;
  jsonColumn: string | null;
}

/**
 * Pick a table to exercise: must have a single-column PK and at least one
 * scalar (string/number/boolean) column we can run findByEq against. We
 * also note whether there's a datetime column (for findByRange) and a
 * json column (for findByJsonPath). Picks the first table that matches.
 */
async function pickTable(
  introspector: MysqlIntrospector,
  schema: string,
): Promise<PickedTable | null> {
  const tables = await introspector.listTables(schema);
  for (const t of tables) {
    try {
      const raw = await introspector.introspectTable({ schema, table: t.name });
      if (raw.primaryKey.length !== 1) continue;
      const pkColumn = raw.primaryKey[0]!;
      const scalar = raw.columns.find(
        (c) =>
          c.name !== pkColumn &&
          (c.type === "string" || c.type === "number" || c.type === "boolean"),
      );
      if (!scalar) continue;
      const range = raw.columns.find((c) => c.type === "datetime");
      const jsonCol = raw.columns.find((c) => c.type === "json");
      const meta: RdbTableMetadataMap = {
        [t.name]: {
          tableName: t.name,
          primaryKey: [pkColumn],
          fields: Object.fromEntries(
            raw.columns.map((c) => [
              c.name,
              { type: c.type, nullable: c.nullable },
            ]),
          ),
        },
      };
      // Probe a real value for the scalar column so findByEq can hit a row.
      // We pull one row and read the value back.
      // (Using introspector.client would couple to internals; just open a
      //  one-shot probe via the SELECT below.)
      return {
        schema,
        name: t.name,
        meta,
        pkColumn,
        scalarColumn: scalar.name,
        scalarValue: undefined, // populated by caller after a probe
        rangeColumn: range?.name ?? null,
        jsonColumn: jsonCol?.name ?? null,
      };
    } catch (err) {
      console.warn(`[smoke] introspectTable failed for ${schema}.${t.name}:`, err);
    }
  }
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const env = await loadResolvedEnv(args.envFile);

  console.log("[smoke] resolving connection (bastion:", env.bastion ? "yes" : "no", ")");
  const start = Date.now();
  const { url: tunneledUrl, tunnel } = await resolveTunneledUrl({
    url: env.url,
    ...(env.bastion && { bastion: env.bastion }),
  });
  console.log(
    `[smoke] connection ready in ${Date.now() - start}ms`,
    tunnel ? `at 127.0.0.1:${tunnel.localPort}` : "(direct)",
  );

  try {
    // 1. Connect via the runtime client.
    console.log("[smoke] opening mysql2 connection (runtime client)");
    const client = await createMysqlClient(tunneledUrl);
    await client.connect();
    client.onError((err) => console.error("[smoke] mysql client error:", err.message));
    try {
      // 2. Introspector via the codegen-side client (separate connection).
      console.log("[smoke] opening introspector connection (codegen client)");
      const introClient = await createIntrospectorMysqlClient(tunneledUrl);
      const introspector = new MysqlIntrospector(introClient);
      try {
        const schemas = await introspector.listSchemas();
        console.log(`[smoke] schemas (${schemas.length}):`, schemas);

        // Pick a target schema. Prefer the one named in the URL pathname;
        // fall back to the first non-system schema.
        const urlSchema = new URL(env.url).pathname.replace(/^\//, "");
        const targetSchema = urlSchema || schemas[0];
        if (!targetSchema) {
          throw new Error("No schema available to introspect");
        }
        console.log(`[smoke] target schema = ${targetSchema}`);

        const tables = await introspector.listTables(targetSchema);
        console.log(`[smoke] tables in ${targetSchema} (${tables.length}):`,
          tables.slice(0, 10).map((t) => t.name));

        const picked = await pickTable(introspector, targetSchema);
        if (!picked) {
          console.warn("[smoke] no table with a single-column PK + scalar column found; skipping data-source ops");
          console.log("[smoke] OK (introspect-only)");
          return;
        }
        console.log(
          `[smoke] picked table: ${picked.name} (pk=${picked.pkColumn}, scalar=${picked.scalarColumn}, range=${picked.rangeColumn}, json=${picked.jsonColumn})`,
        );

        // 3. Probe a scalar value to use in findByEq.
        const probeQuery = `SELECT \`${picked.scalarColumn}\`, \`${picked.pkColumn}\` FROM \`${picked.name}\` WHERE \`${picked.scalarColumn}\` IS NOT NULL LIMIT 1`;
        const probeResult = await client.query<{
          [k: string]: unknown;
        }>({ text: probeQuery });
        const probeRow = probeResult.rows[0];
        if (!probeRow) {
          console.warn(`[smoke] table ${picked.name} is empty — skipping data-source ops`);
          console.log("[smoke] OK (introspect-only)");
          return;
        }
        const scalarValue = probeRow[picked.scalarColumn];
        const probedPk = probeRow[picked.pkColumn];
        console.log(`[smoke] probe row pk type=${typeof probedPk}, scalar type=${typeof scalarValue}`);

        // 4. Build a DataSource and exercise the 4 read methods + explainSql.
        const ds = createMysqlDataSource({
          client,
          tableMetadata: picked.meta,
        });

        console.log(`[smoke] findByEq ${picked.name} WHERE ${picked.scalarColumn} = <probed> LIMIT 3`);
        const eqRows = await ds.findByEq({
          table: picked.name,
          field: picked.scalarColumn,
          value: scalarValue as string | number | boolean,
          columns: [picked.pkColumn, picked.scalarColumn],
          limit: 3,
        });
        console.log(`[smoke]   got ${eqRows.length} rows`);

        if (probedPk !== undefined && probedPk !== null) {
          console.log(`[smoke] findByPk ${picked.name} WHERE ${picked.pkColumn} = <probed>`);
          const single = await ds.findByPk({
            table: picked.name,
            pk: probedPk as string | number,
            columns: [picked.pkColumn],
          });
          console.log(`[smoke]   found: ${single ? "yes" : "no"}`);
          if (single && Object.keys(single).length > 1) {
            console.warn(
              `[smoke]   WARN: projection returned ${Object.keys(single).length} cols, expected 1`,
            );
          }
        }

        if (picked.rangeColumn) {
          const fromIso = "1900-01-01T00:00:00Z";
          const toIso = "2100-01-01T00:00:00Z";
          console.log(`[smoke] findByRange ${picked.name} WHERE ${picked.rangeColumn} BETWEEN ... LIMIT 3`);
          const rangeRows = await ds.findByRange({
            table: picked.name,
            field: picked.rangeColumn,
            from: new Date(fromIso),
            to: new Date(toIso),
            columns: [picked.pkColumn],
            limit: 3,
          });
          console.log(`[smoke]   got ${rangeRows.length} rows`);
        } else {
          console.log("[smoke] no datetime column — skipping findByRange");
        }

        if (picked.jsonColumn) {
          console.log(`[smoke] findByJsonPath ${picked.name} WHERE ${picked.jsonColumn} -> $.smoketest = 'no-such' LIMIT 3`);
          const jsonRows = await ds.findByJsonPath({
            table: picked.name,
            field: picked.jsonColumn,
            path: "$.smoketest",
            value: "no-such-value-smoketest",
            columns: [picked.pkColumn],
            limit: 3,
          });
          console.log(`[smoke]   got ${jsonRows.length} rows (0 expected for synthetic path)`);
        } else {
          console.log("[smoke] no json column — skipping findByJsonPath");
        }

        console.log("[smoke] explainSql");
        const explain = await ds.explainSql({
          sql: `SELECT \`${picked.pkColumn}\` FROM \`${picked.name}\` LIMIT 1`,
          params: [],
        });
        console.log(
          `[smoke]   estimatedRows=${explain.estimatedRows}, totalCost=${explain.totalCost}, planSummary=${explain.planSummary}`,
        );
      } finally {
        await introspector.close();
      }
    } finally {
      await client.end();
    }
  } finally {
    await tunnel?.close();
  }
  console.log("[smoke] OK");
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exit(1);
});
