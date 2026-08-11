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
 * Schema-agnostic by design: the table, primary key and columns are all
 * discovered at runtime, so this runs against any Postgres database rather
 * than asserting on one particular deployment's tables and data.
 *
 * No PII is printed — only ids, counts, and structural info.
 */
import { createSecretResolver, envSource, loadEnvFile } from "mcp-shared-secrets";
import { resolveTunneledUrl, type BastionConfig } from "mcp-shared/tunnel";
import {
  PostgresIntrospector,
  createPgClient as createIntrospectorPgClient,
} from "mcp-shared-db-codegen";
import type { RdbTableMetadataMap } from "mcp-shared-db-core";
import { createPgClient } from "../src/client.js";
import { createPostgresDataSource } from "../src/factory.js";

interface Args {
  envFile: string;
}

function parseArgs(): Args {
  const envFile = process.argv[2];
  if (!envFile) {
    throw new Error("Usage: tsx scripts/smoke-test-postgres.ts <env-file>");
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
  // Bastion is optional; a missing key must not fail the run.
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
  rangeColumn: string | null;
  jsonColumn: string | null;
}

/**
 * Pick a table to exercise: must have a single-column PK and at least one
 * other scalar column, so findByEq and findByPk have something to work with.
 */
async function pickTable(
  introspector: PostgresIntrospector,
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

      const meta: RdbTableMetadataMap = {
        [t.name]: {
          tableName: t.name,
          primaryKey: [pkColumn],
          fields: Object.fromEntries(
            raw.columns.map((c) => [c.name, { type: c.type, nullable: c.nullable }]),
          ),
        },
      };
      return {
        schema,
        name: t.name,
        meta,
        pkColumn,
        scalarColumn: scalar.name,
        rangeColumn: raw.columns.find((c) => c.type === "datetime")?.name ?? null,
        jsonColumn: raw.columns.find((c) => c.type === "json")?.name ?? null,
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
    console.log("[smoke] opening pg connection (runtime client)");
    const client = await createPgClient(tunneledUrl);
    try {
      console.log("[smoke] opening introspector connection (codegen client)");
      const introClient = await createIntrospectorPgClient(tunneledUrl);
      const introspector = new PostgresIntrospector(introClient);
      try {
        const schemas = await introspector.listSchemas();
        console.log(`[smoke] schemas (${schemas.length}):`, schemas);

        // Prefer the schema named in the URL; otherwise the first non-system one.
        const urlSchema = new URL(env.url).searchParams.get("schema");
        const targetSchema = urlSchema ?? schemas.find((s) => s === "public") ?? schemas[0];
        if (!targetSchema) throw new Error("No schema available to introspect");
        console.log(`[smoke] target schema = ${targetSchema}`);

        const tables = await introspector.listTables(targetSchema);
        console.log(
          `[smoke] tables in ${targetSchema} (${tables.length}):`,
          tables.slice(0, 10).map((t) => t.name),
        );

        const picked = await pickTable(introspector, targetSchema);
        if (!picked) {
          console.warn(
            "[smoke] no table with a single-column PK + scalar column found; skipping data-source ops",
          );
          console.log("[smoke] OK (introspect-only)");
          return;
        }
        console.log(
          `[smoke] picked table: ${picked.name} (pk=${picked.pkColumn}, scalar=${picked.scalarColumn}, range=${picked.rangeColumn}, json=${picked.jsonColumn})`,
        );

        // Probe a real value so findByEq can hit a row.
        const probe = await client.query<Record<string, unknown>>({
          text: `SELECT "${picked.scalarColumn}", "${picked.pkColumn}" FROM "${picked.schema}"."${picked.name}" WHERE "${picked.scalarColumn}" IS NOT NULL LIMIT 1`,
        });
        const probeRow = probe.rows[0];
        if (!probeRow) {
          console.warn(`[smoke] table ${picked.name} is empty — skipping data-source ops`);
          console.log("[smoke] OK (introspect-only)");
          return;
        }
        const scalarValue = probeRow[picked.scalarColumn];
        const probedPk = probeRow[picked.pkColumn];
        console.log(
          `[smoke] probe row pk type=${typeof probedPk}, scalar type=${typeof scalarValue}`,
        );

        const ds = createPostgresDataSource({ client, tableMetadata: picked.meta });

        console.log(
          `[smoke] findByEq ${picked.name} WHERE ${picked.scalarColumn} = <probed> LIMIT 3`,
        );
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
          console.log(
            `[smoke] findByRange ${picked.name} WHERE ${picked.rangeColumn} BETWEEN ... LIMIT 3`,
          );
          const rangeRows = await ds.findByRange({
            table: picked.name,
            field: picked.rangeColumn,
            from: new Date("1900-01-01T00:00:00Z"),
            to: new Date("2100-01-01T00:00:00Z"),
            columns: [picked.pkColumn],
            limit: 3,
          });
          console.log(`[smoke]   got ${rangeRows.length} rows`);
        } else {
          console.log("[smoke] no datetime column — skipping findByRange");
        }

        if (picked.jsonColumn) {
          console.log(
            `[smoke] findByJsonPath ${picked.name} WHERE ${picked.jsonColumn} -> $.smoketest LIMIT 3`,
          );
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
          sql: `SELECT "${picked.pkColumn}" FROM "${picked.schema}"."${picked.name}" LIMIT 1`,
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
