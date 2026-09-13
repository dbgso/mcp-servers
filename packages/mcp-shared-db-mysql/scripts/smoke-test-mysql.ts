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

        // 3. Probe one real row up front. Every assertion below is anchored
        //    to it: the values handed to the read methods came out of this
        //    row, so each query has a known-correct answer to measure against.
        const probeColumns = [
          picked.scalarColumn,
          picked.pkColumn,
          ...(picked.rangeColumn ? [picked.rangeColumn] : []),
          ...(picked.jsonColumn ? [picked.jsonColumn] : []),
        ];
        const probeQuery = `SELECT ${probeColumns.map((c) => `\`${c}\``).join(", ")} FROM \`${picked.name}\` WHERE \`${picked.scalarColumn}\` IS NOT NULL LIMIT 1`;
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
            from: new Date(fromIso),
            to: new Date(toIso),
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
          // nothing either, which is how the bind-order swap survived review.
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
          check(
            jsonRows.length === 0,
            `findByJsonPath matched ${jsonRows.length} rows on a path no document carries`,
          );
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
