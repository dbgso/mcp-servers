/**
 * What the database smoke scripts share.
 *
 * The Postgres and MySQL smoke tests ask the same questions of their engine;
 * only connecting, quoting and the shape of a schema differ. Everything that
 * does not differ lives here, so a fix to one engine's check is a fix to both.
 *
 * Deliberately free of imports. This file sits outside every workspace
 * package, so a bare import here would resolve against the repository root,
 * which has none of them installed. The types it needs are written
 * structurally instead, and each script passes in its engine's own objects;
 * the type checker confirms they fit (`tsconfig.scripts.json`).
 */

/**
 * Fail on a wrong answer, not only on a thrown error.
 *
 * Every step of the smoke tests used to be a `console.log` and nothing else,
 * so a query that came back with the wrong rows -- or none at all -- still
 * ended in `[smoke] OK`. The bind-order bug these exist to catch only surfaced
 * because MySQL rejected the statement outright; the same swap on an engine
 * that found the query merely unsatisfiable would have passed silently.
 */
export function check(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
}

/** The env file named on the command line; every smoke script takes one. */
export function envFileArg(params: { script: string }): string {
  const envFile = process.argv[2];
  if (!envFile) {
    throw new Error(`Usage: tsx scripts/${params.script} <env-file>`);
  }
  return envFile;
}

/** The SSH bastion an env file names, if it names one. */
export interface SmokeBastion {
  host: string;
  identityFile?: string;
}

/**
 * Read the optional bastion settings through a secret resolver's `cached`,
 * which throws for a key that is not set. A missing host means "connect
 * directly"; a missing key file means "let ssh pick its default".
 */
export function readBastion(params: {
  cached: (key: string) => string;
  hostKey: string;
  identityFileKey: string;
}): SmokeBastion | null {
  const optional = (key: string): string | null => {
    try {
      return params.cached(key);
    } catch {
      return null;
    }
  };
  const host = optional(params.hostKey);
  if (host === null) return null;
  const identityFile = optional(params.identityFileKey);
  return identityFile === null ? { host } : { host, identityFile };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Find a top-level key in a probed JSON value whose own value is a scalar, so
 * the JSON-path query can be given a path and a value that are known to match
 * a real row. Returns null when the document has no usable key, in which case
 * the caller falls back to the weaker no-match check.
 */
export function pickJsonProbe(raw: unknown): { path: string; value: string } | null {
  const doc: unknown = typeof raw === "string" ? safeParse(raw) : raw;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const hit = Object.entries(doc as Record<string, unknown>).find(([, value]) => isScalar(value));
  // `#>>` and JSON_UNQUOTE both yield text, so the comparison value is a
  // string on either engine.
  return hit ? { path: `$.${hit[0]}`, value: String(hit[1]) } : null;
}

/** The part of an introspector's column the smoke tests read. */
export interface SmokeColumn {
  name: string;
  type: string;
  nullable: boolean;
}

/** The part of an engine's introspector the smoke tests use. */
export interface SmokeIntrospector<C extends SmokeColumn> {
  listTables(schema: string): Promise<readonly { name: string }[]>;
  introspectTable(input: {
    schema: string;
    table: string;
  }): Promise<{ primaryKey: readonly string[]; columns: readonly C[] }>;
}

export interface PickedTable<C extends SmokeColumn> {
  schema: string;
  name: string;
  /** Ready to drop into the engine's `RdbTableMetadataMap`. */
  metadata: {
    tableName: string;
    primaryKey: string[];
    fields: Record<string, { type: C["type"]; nullable: boolean }>;
  };
  pkColumn: string;
  scalarColumn: string;
  rangeColumn: string | null;
  jsonColumn: string | null;
}

/** The key and scalar column a usable table offers, or null if it is not usable. */
function tableShape<C extends SmokeColumn>(raw: {
  primaryKey: readonly string[];
  columns: readonly C[];
}): { pkColumn: string; scalar: C } | null {
  const [pkColumn, ...rest] = raw.primaryKey;
  if (pkColumn === undefined || rest.length > 0) return null;
  const scalar = raw.columns.find(
    (c) => c.name !== pkColumn && ["string", "number", "boolean"].includes(c.type),
  );
  return scalar ? { pkColumn, scalar } : null;
}

/**
 * Pick a table to exercise: it must have a single-column primary key and at
 * least one other scalar column, so findByEq and findByPk have something to
 * work with. Also notes a datetime column (for findByRange) and a json column
 * (for findByJsonPath), when there is one.
 *
 * The seeds deliberately put a composite-key table first, so this always
 * rejects one table before it accepts another.
 */
export async function pickTable<C extends SmokeColumn>(params: {
  introspector: SmokeIntrospector<C>;
  schema: string;
}): Promise<PickedTable<C> | null> {
  const { introspector, schema } = params;
  for (const t of await introspector.listTables(schema)) {
    try {
      const raw = await introspector.introspectTable({ schema, table: t.name });
      const shape = tableShape(raw);
      if (!shape) continue;
      return {
        schema,
        name: t.name,
        metadata: {
          tableName: t.name,
          primaryKey: [shape.pkColumn],
          fields: Object.fromEntries(
            raw.columns.map((c) => [c.name, { type: c.type, nullable: c.nullable }]),
          ),
        },
        pkColumn: shape.pkColumn,
        scalarColumn: shape.scalar.name,
        rangeColumn: raw.columns.find((c) => c.type === "datetime")?.name ?? null,
        jsonColumn: raw.columns.find((c) => c.type === "json")?.name ?? null,
      };
    } catch (err) {
      console.warn(`[smoke] introspectTable failed for ${schema}.${t.name}:`, err);
    }
  }
  return null;
}

type Row = Record<string, unknown>;

interface SmokePlan {
  estimatedRows: number | null;
  totalCost: number | null;
  planSummary: string;
}

/**
 * The read methods of `DataSource` the smoke tests call. Written out rather
 * than imported (see the file comment); an engine's real `DataSource` has to
 * be assignable to it, which the type checker confirms at each call site.
 */
export interface SmokeDataSource {
  findByEq(params: {
    table: string;
    field: string;
    value: string | number | boolean;
    columns: string[];
    limit: number;
  }): Promise<Row[]>;
  findByPk(params: { table: string; pk: string | number; columns: string[] }): Promise<Row | null>;
  findByRange(params: RangeQuery): Promise<Row[]>;
  explainFindByRange(params: RangeQuery): Promise<SmokePlan>;
  findByJsonPath(params: {
    table: string;
    field: string;
    path: string;
    value: string;
    columns: string[];
    limit: number;
  }): Promise<Row[]>;
  explainSql(params: { sql: string; params: unknown[] }): Promise<SmokePlan>;
}

interface RangeQuery {
  table: string;
  field: string;
  from: Date;
  to: Date;
  columns: string[];
  limit: number;
}

interface Exercise {
  ds: SmokeDataSource;
  picked: PickedTable<SmokeColumn>;
  /** One real row of `picked`; every assertion is measured against it. */
  probeRow: Row;
}

async function exerciseFindByEq({ ds, picked, probeRow }: Exercise): Promise<void> {
  console.log(`[smoke] findByEq ${picked.name} WHERE ${picked.scalarColumn} = <probed> LIMIT 3`);
  const rows = await ds.findByEq({
    table: picked.name,
    field: picked.scalarColumn,
    value: probeRow[picked.scalarColumn] as string | number | boolean,
    columns: [picked.pkColumn, picked.scalarColumn],
    limit: 3,
  });
  console.log(`[smoke]   got ${rows.length} rows`);
  check(
    rows.length >= 1,
    `findByEq returned nothing, though the value it searched for was read out of ${picked.name}`,
  );
}

async function exerciseFindByPk({ ds, picked, probeRow }: Exercise): Promise<void> {
  const pk = probeRow[picked.pkColumn];
  if (pk === undefined || pk === null) return;
  console.log(`[smoke] findByPk ${picked.name} WHERE ${picked.pkColumn} = <probed>`);
  const single = await ds.findByPk({
    table: picked.name,
    pk: pk as string | number,
    columns: [picked.pkColumn],
  });
  console.log(`[smoke]   found: ${single ? "yes" : "no"}`);
  check(single != null, `findByPk missed a primary key read out of ${picked.name}`);
  // A projection that widens hands back columns the caller did not ask for,
  // which is the same failure the visibility policy exists to prevent.
  check(
    Object.keys(single).length === 1,
    `findByPk returned ${Object.keys(single).length} columns for a single-column projection`,
  );
}

async function exerciseFindByRange({ ds, picked, probeRow }: Exercise): Promise<void> {
  const field = picked.rangeColumn;
  if (!field) {
    console.log("[smoke] no datetime column — skipping findByRange");
    return;
  }
  const query: RangeQuery = {
    table: picked.name,
    field,
    from: new Date("1900-01-01T00:00:00Z"),
    to: new Date("2100-01-01T00:00:00Z"),
    columns: [picked.pkColumn],
    limit: 3,
  };
  console.log(`[smoke] findByRange ${picked.name} WHERE ${field} BETWEEN ... LIMIT 3`);
  const rows = await ds.findByRange(query);
  console.log(`[smoke]   got ${rows.length} rows`);
  // Only assert when the probed row actually carries a timestamp: the column
  // may exist and be null throughout on a database this was pointed at rather
  // than seeded.
  const probed = probeRow[field];
  if (probed === undefined || probed === null) {
    console.log("[smoke]   (probed row has no value there — result not asserted)");
  } else {
    check(
      rows.length >= 1,
      `findByRange spanning 1900-2100 returned nothing, though ${field} holds a value in the probed row`,
    );
  }

  // `get_by_date_range` runs this as its auto-EXPLAIN guard, so an engine that
  // rejects the wrapped statement breaks that operation and nothing else
  // notices.
  console.log("[smoke] explainFindByRange");
  const plan = await ds.explainFindByRange(query);
  console.log(`[smoke]   estimatedRows=${plan.estimatedRows}, planSummary=${plan.planSummary}`);
  check(
    plan.planSummary.length > 0,
    "explainFindByRange produced an empty plan summary — the engine's plan format was not parsed",
  );
}

async function exerciseJsonHit(params: Exercise & { field: string }): Promise<void> {
  const { ds, picked, probeRow, field } = params;
  // A path and value taken out of the probed document, so a correct query has
  // to find that row. Checking only that a made-up path finds nothing is
  // vacuous: a query bound the wrong way round finds nothing either, which is
  // how the MySQL swap survived review.
  const probe = pickJsonProbe(probeRow[field]);
  if (!probe) {
    console.log(`[smoke] ${field} has no scalar top-level key — positive JSON check skipped`);
    return;
  }
  console.log(
    `[smoke] findByJsonPath ${picked.name} WHERE ${field} -> ${probe.path} = <probed> LIMIT 3`,
  );
  const hit = await ds.findByJsonPath({
    table: picked.name,
    field,
    path: probe.path,
    value: probe.value,
    columns: [picked.pkColumn],
    limit: 3,
  });
  console.log(`[smoke]   got ${hit.length} rows (>=1 expected)`);
  check(
    hit.length >= 1,
    `findByJsonPath found nothing for ${probe.path}, a path and value read out of the probed row — path and value may be bound in the wrong order`,
  );
  const pks = hit.map((r) => String(r[picked.pkColumn]));
  check(
    pks.includes(String(probeRow[picked.pkColumn])),
    "findByJsonPath matched rows, but not the row the path and value came from",
  );
}

async function exerciseFindByJsonPath(params: Exercise): Promise<void> {
  const { ds, picked } = params;
  const field = picked.jsonColumn;
  if (!field) {
    console.log("[smoke] no json column — skipping findByJsonPath");
    return;
  }
  await exerciseJsonHit({ ...params, field });

  // The other direction: a path nothing carries must match nothing.
  console.log(`[smoke] findByJsonPath ${picked.name} WHERE ${field} -> $.smoketest LIMIT 3`);
  const rows = await ds.findByJsonPath({
    table: picked.name,
    field,
    path: "$.smoketest",
    value: "no-such-value-smoketest",
    columns: [picked.pkColumn],
    limit: 3,
  });
  console.log(`[smoke]   got ${rows.length} rows (0 expected for synthetic path)`);
  check(rows.length === 0, `findByJsonPath matched ${rows.length} rows on a path no document carries`);
}

/**
 * Run every read operation against `picked`, each anchored to `probeRow`, and
 * finish with `explainSql` on `explainTarget` -- a SELECT the engine's own
 * quoting has already been applied to.
 */
export async function exerciseDataSource(params: Exercise & { explainTarget: string }): Promise<void> {
  await exerciseFindByEq(params);
  await exerciseFindByPk(params);
  await exerciseFindByRange(params);
  await exerciseFindByJsonPath(params);

  console.log("[smoke] explainSql");
  const explain = await params.ds.explainSql({ sql: params.explainTarget, params: [] });
  console.log(
    `[smoke]   estimatedRows=${explain.estimatedRows}, totalCost=${explain.totalCost}, planSummary=${explain.planSummary}`,
  );
  check(
    explain.planSummary.length > 0,
    "explainSql produced an empty plan summary — the engine's plan format was not parsed",
  );
}

/** The columns a probe row has to carry for `exerciseDataSource`. */
export function probeColumns(picked: PickedTable<SmokeColumn>): string[] {
  return [picked.scalarColumn, picked.pkColumn, picked.rangeColumn, picked.jsonColumn].filter(
    (c): c is string => c !== null,
  );
}

/** A connection the data-source operations run on. */
export interface SmokeRuntime<C extends SmokeColumn> {
  dataSource(tableMetadata: Record<string, PickedTable<C>["metadata"]>): SmokeDataSource;
  query(sql: string): Promise<Row[]>;
  close(): Promise<void>;
}

/** The introspector, plus what `runEngineSmoke` needs around it. */
export interface SmokeSchemaIntrospector<C extends SmokeColumn> extends SmokeIntrospector<C> {
  listSchemas(): Promise<string[]>;
  close(): Promise<void>;
}

/** Everything `runEngineSmoke` needs to know about one engine. */
export interface SmokeEngine<C extends SmokeColumn> {
  /** For log lines, e.g. "pg". */
  label: string;
  openRuntime(url: string): Promise<SmokeRuntime<C>>;
  /** A second connection, through the codegen-side client. */
  openIntrospector(url: string): Promise<SmokeSchemaIntrospector<C>>;
  pickSchema(params: { url: string; schemas: readonly string[] }): string | undefined;
  /** The engine dialect's `quoteIdent`. */
  quoteIdent(name: string): string;
  /** `picked`'s table, quoted and qualified as this engine needs. */
  tableRef(picked: PickedTable<C>): string;
}

/** `resolveTunneledUrl` from `mcp-shared/tunnel`, as the smoke tests call it. */
export type ResolveTunneledUrl = (params: {
  url: string;
  bastion?: SmokeBastion;
}) => Promise<{ url: string; tunnel?: { localPort: number; close(): Promise<void> } | null }>;

async function smokeTables<C extends SmokeColumn>(params: {
  engine: SmokeEngine<C>;
  runtime: SmokeRuntime<C>;
  introspector: SmokeSchemaIntrospector<C>;
  url: string;
}): Promise<void> {
  const { engine, runtime, introspector } = params;
  const schemas = await introspector.listSchemas();
  console.log(`[smoke] schemas (${schemas.length}):`, schemas);
  const schema = engine.pickSchema({ url: params.url, schemas });
  if (!schema) throw new Error("No schema available to introspect");
  console.log(`[smoke] target schema = ${schema}`);

  const tables = await introspector.listTables(schema);
  console.log(
    `[smoke] tables in ${schema} (${tables.length}):`,
    tables.slice(0, 10).map((t) => t.name),
  );
  const picked = await pickTable({ introspector, schema });
  if (!picked) {
    console.warn("[smoke] no table with a single-column PK + scalar column found; skipping data-source ops");
    console.log("[smoke] OK (introspect-only)");
    return;
  }
  console.log(
    `[smoke] picked table: ${picked.name} (pk=${picked.pkColumn}, scalar=${picked.scalarColumn}, range=${picked.rangeColumn}, json=${picked.jsonColumn})`,
  );

  // Probe one real row up front. Every assertion is anchored to it: the values
  // handed to the read methods came out of this row, so each query has a
  // known-correct answer to be measured against.
  const columns = probeColumns(picked).map((c) => engine.quoteIdent(c)).join(", ");
  const [probeRow] = await runtime.query(
    `SELECT ${columns} FROM ${engine.tableRef(picked)} WHERE ${engine.quoteIdent(picked.scalarColumn)} IS NOT NULL LIMIT 1`,
  );
  if (!probeRow) {
    console.warn(`[smoke] table ${picked.name} is empty — skipping data-source ops`);
    console.log("[smoke] OK (introspect-only)");
    return;
  }
  console.log(
    `[smoke] probe row pk type=${typeof probeRow[picked.pkColumn]}, scalar type=${typeof probeRow[picked.scalarColumn]}`,
  );

  await exerciseDataSource({
    ds: runtime.dataSource({ [picked.name]: picked.metadata }),
    picked,
    probeRow,
    explainTarget: `SELECT ${engine.quoteIdent(picked.pkColumn)} FROM ${engine.tableRef(picked)} LIMIT 1`,
  });
  console.log("[smoke] OK");
}

/**
 * Connect (through the bastion, if there is one), introspect, pick a table and
 * run every read operation against it. Schema-agnostic by design: the table,
 * key and columns are all discovered at run time, so this runs against any
 * database rather than asserting on one deployment's tables and data. A
 * database with no usable table, or whose usable table is empty, is reported
 * as "OK (introspect-only)".
 */
export async function runEngineSmoke<C extends SmokeColumn>(params: {
  engine: SmokeEngine<C>;
  url: string;
  bastion: SmokeBastion | null;
  resolveTunneledUrl: ResolveTunneledUrl;
}): Promise<void> {
  const { engine } = params;
  console.log("[smoke] resolving connection (bastion:", params.bastion ? "yes" : "no", ")");
  const start = Date.now();
  const { url, tunnel } = await params.resolveTunneledUrl({
    url: params.url,
    ...(params.bastion && { bastion: params.bastion }),
  });
  console.log(
    `[smoke] connection ready in ${Date.now() - start}ms`,
    tunnel ? `at 127.0.0.1:${tunnel.localPort}` : "(direct)",
  );
  try {
    console.log(`[smoke] opening ${engine.label} connection (runtime client)`);
    const runtime = await engine.openRuntime(url);
    try {
      console.log("[smoke] opening introspector connection (codegen client)");
      const introspector = await engine.openIntrospector(url);
      try {
        await smokeTables({ engine, runtime, introspector, url: params.url });
      } finally {
        await introspector.close();
      }
    } finally {
      await runtime.close();
    }
  } finally {
    await tunnel?.close();
  }
}

/** A runtime connection over a driver client that takes `{ text }` queries. */
export class ClientRuntime<C extends SmokeColumn> implements SmokeRuntime<C> {
  private readonly client: {
    query(args: { text: string }): Promise<{ rows: Row[] }>;
    end(): Promise<void>;
  };
  private readonly makeDataSource: SmokeRuntime<C>["dataSource"];

  constructor(params: {
    client: ClientRuntime<C>["client"];
    dataSource: SmokeRuntime<C>["dataSource"];
  }) {
    this.client = params.client;
    this.makeDataSource = params.dataSource;
  }

  dataSource(tableMetadata: Record<string, PickedTable<C>["metadata"]>): SmokeDataSource {
    return this.makeDataSource(tableMetadata);
  }

  async query(sql: string): Promise<Row[]> {
    return (await this.client.query({ text: sql })).rows;
  }

  close(): Promise<void> {
    return this.client.end();
  }
}

/**
 * The parts of `mcp-shared-secrets` an engine smoke script reads its env file
 * with. Passed in rather than imported, for the reason in the file comment.
 */
export interface SmokeSecrets<S> {
  loadEnvFile(path: string): unknown;
  createSecretResolver(config: { schemes: Record<string, S> }): {
    preload(keys: string[]): Promise<void>;
    cached(key: string): string;
  };
  envSource(): S;
}

/**
 * The whole of an engine smoke script's `main`: read the env file named on
 * the command line (`DBGEN_URL`, optionally `DBGEN_BASTION_HOST` and
 * `DBGEN_BASTION_KEY`) and run `runEngineSmoke`. Exits non-zero on failure.
 */
export function runEngineSmokeScript<C extends SmokeColumn, S>(params: {
  script: string;
  engine: SmokeEngine<C>;
  secrets: SmokeSecrets<S>;
  resolveTunneledUrl: ResolveTunneledUrl;
}): void {
  const { secrets } = params;
  const run = async (): Promise<void> => {
    secrets.loadEnvFile(envFileArg({ script: params.script }));
    const resolver = secrets.createSecretResolver({ schemes: { env: secrets.envSource() } });
    await resolver.preload(["DBGEN_URL", "DBGEN_BASTION_HOST", "DBGEN_BASTION_KEY"]);
    await runEngineSmoke({
      engine: params.engine,
      url: resolver.cached("DBGEN_URL"),
      bastion: readBastion({
        cached: (key) => resolver.cached(key),
        hostKey: "DBGEN_BASTION_HOST",
        identityFileKey: "DBGEN_BASTION_KEY",
      }),
      resolveTunneledUrl: params.resolveTunneledUrl,
    });
  };
  run().catch((err: unknown) => {
    console.error("[smoke] FAIL:", err);
    process.exit(1);
  });
}

/** The table both seeds create (ci/db/*-init.sql), and the one the db-read checks read. */
export const SMOKE_ORDERS = "smoke_orders";

interface SeedField {
  type: "string" | "number" | "boolean" | "datetime" | "json";
  nullable: boolean;
}

/**
 * Metadata for `smoke_orders` as the seed defines it: its key and `status`,
 * plus whichever other columns a check names in `extraFields`.
 */
export function smokeOrdersMetadata(params: { extraFields: Record<string, SeedField> }): Record<
  string,
  { tableName: string; primaryKey: string[]; fields: Record<string, SeedField> }
> {
  return {
    [SMOKE_ORDERS]: {
      tableName: SMOKE_ORDERS,
      primaryKey: ["id"],
      fields: {
        id: { type: "number", nullable: false },
        status: { type: "string", nullable: false },
        ...params.extraFields,
      },
    },
  };
}
