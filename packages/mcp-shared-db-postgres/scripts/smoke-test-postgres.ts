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

/**
 * Fail on a wrong answer, not only on a thrown error.
 *
 * Every step below used to be a `console.log` and nothing else, so a query
 * that came back with the wrong rows -- or none at all -- still ended in
 * `[smoke] OK`. The bind-order bug this suite exists to catch only surfaced
 * because MySQL rejected the statement outright; the same swap on an engine
 * that found the query merely unsatisfiable would have passed silently.
 */
function check(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
}

/**
 * Find a top-level key in a probed JSON value whose own value is a scalar, so
 * the JSON-path query can be given a path and a value that are known to match
 * a real row. Returns null when the document has no usable key, in which case
 * the caller falls back to the weaker no-match check.
 */
function pickJsonProbe(raw: unknown): { path: string; value: string } | null {
  const doc: unknown = typeof raw === "string" ? safeParse(raw) : raw;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      // `#>>` and JSON_UNQUOTE both yield text, so the comparison value is a
      // string on either engine.
      return { path: `$.${key}`, value: String(value) };
    }
  }
  return null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

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
    // `createPgClient` constructs a pg.Client and stops there, matching what
    // db-read-mcp's strategy does before it connects. Querying an unconnected
    // client does not throw -- pg queues the query against a connection that
    // will never open -- so leaving this out hangs rather than fails.
    await client.connect();
    client.on("error", (err) => console.error("[smoke] pg client error:", err.message));
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

        // Probe one real row up front. Every assertion below is anchored to
        // it: the values handed to the read methods came out of this row, so
        // each query has a known-correct answer to be measured against.
        const probeColumns = [
          picked.scalarColumn,
          picked.pkColumn,
          ...(picked.rangeColumn ? [picked.rangeColumn] : []),
          ...(picked.jsonColumn ? [picked.jsonColumn] : []),
        ];
        const probe = await client.query<Record<string, unknown>>({
          text: `SELECT ${probeColumns.map((c) => `"${c}"`).join(", ")} FROM "${picked.schema}"."${picked.name}" WHERE "${picked.scalarColumn}" IS NOT NULL LIMIT 1`,
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
        check(
          eqRows.length >= 1,
          `findByEq returned nothing, though the value it searched for was read out of ${picked.name}`,
        );

        if (probedPk !== undefined && probedPk !== null) {
          console.log(`[smoke] findByPk ${picked.name} WHERE ${picked.pkColumn} = <probed>`);
          const single = await ds.findByPk({
            table: picked.name,
            pk: probedPk as string | number,
            columns: [picked.pkColumn],
          });
          console.log(`[smoke]   found: ${single ? "yes" : "no"}`);
          check(single != null, `findByPk missed a primary key read out of ${picked.name}`);
          // A projection that widens hands back columns the caller did not ask
          // for, which is the same failure the visibility policy exists to
          // prevent. Asserted rather than warned.
          check(
            Object.keys(single).length === 1,
            `findByPk returned ${Object.keys(single).length} columns for a single-column projection`,
          );
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
          // Only assert when the probed row actually carries a timestamp: the
          // column may exist and be null throughout on a database this script
          // was pointed at rather than seeded.
          const probedRange = probeRow[picked.rangeColumn];
          if (probedRange !== undefined && probedRange !== null) {
            check(
              rangeRows.length >= 1,
              `findByRange spanning 1900-2100 returned nothing, though ${picked.rangeColumn} holds a value in the probed row`,
            );
          } else {
            console.log("[smoke]   (probed row has no value there — result not asserted)");
          }

          // The only data-source method the suite never called. `get_by_date_range`
          // runs it as its auto-EXPLAIN guard, so an engine that rejects the
          // wrapped statement breaks that operation and nothing else notices.
          console.log("[smoke] explainFindByRange");
          const rangePlan = await ds.explainFindByRange({
            table: picked.name,
            field: picked.rangeColumn,
            from: new Date("1900-01-01T00:00:00Z"),
            to: new Date("2100-01-01T00:00:00Z"),
            columns: [picked.pkColumn],
            limit: 3,
          });
          console.log(
            `[smoke]   estimatedRows=${rangePlan.estimatedRows}, planSummary=${rangePlan.planSummary}`,
          );
          check(
            rangePlan.planSummary.length > 0,
            "explainFindByRange produced an empty plan summary — the engine's plan format was not parsed",
          );
        } else {
          console.log("[smoke] no datetime column — skipping findByRange");
        }

        if (picked.jsonColumn) {
          // A path and value taken out of the probed document, so a correct
          // query has to find that row. Checking only that a made-up path
          // finds nothing is vacuous: a query bound the wrong way round finds
          // nothing either, which is how the MySQL swap survived review.
          const jsonProbe = pickJsonProbe(probeRow[picked.jsonColumn]);
          if (jsonProbe) {
            console.log(
              `[smoke] findByJsonPath ${picked.name} WHERE ${picked.jsonColumn} -> ${jsonProbe.path} = <probed> LIMIT 3`,
            );
            const hit = await ds.findByJsonPath({
              table: picked.name,
              field: picked.jsonColumn,
              path: jsonProbe.path,
              value: jsonProbe.value,
              columns: [picked.pkColumn],
              limit: 3,
            });
            console.log(`[smoke]   got ${hit.length} rows (>=1 expected)`);
            check(
              hit.length >= 1,
              `findByJsonPath found nothing for ${jsonProbe.path}, a path and value read out of the probed row — path and value may be bound in the wrong order`,
            );
            const pks = hit.map((r) => String(r[picked.pkColumn]));
            check(
              pks.includes(String(probedPk)),
              "findByJsonPath matched rows, but not the row the path and value came from",
            );
          } else {
            console.log(
              `[smoke] ${picked.jsonColumn} has no scalar top-level key — positive JSON check skipped`,
            );
          }

          // The other direction: a path nothing carries must match nothing.
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
          check(
            jsonRows.length === 0,
            `findByJsonPath matched ${jsonRows.length} rows on a path no document carries`,
          );
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
        check(
          explain.planSummary.length > 0,
          "explainSql produced an empty plan summary — the engine's plan format was not parsed",
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
