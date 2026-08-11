/**
 * Thin MCP server wrapper around `mcp-shared-db` + `mcp-shared-db-postgres`.
 *
 * Wires the Stdio transport, loads user-supplied `tableMetadata` /
 * `selectableFields` modules, opens an SSH-bastion-tunneled `pg.Client`, and
 * registers the describe/execute tool pair on a stock `ToolRegistry`.
 *
 * Secrets resolution:
 *   - Optionally loads a dotenv file (`--env-file <path>`) at startup.
 *   - Constructs a `mcp-shared-secrets` resolver with `ssm:`, `sm:`, `env:`
 *     schemes registered.
 *   - Eagerly preloads `DBREAD_URL` / `DBREAD_BASTION_HOST` / `DBREAD_BASTION_KEY`
 *     so the connection layer can read them via the synchronous
 *     `cached(...)` API.
 *   - Also preloads the per-component alternative
 *     (`DBREAD_DIALECT`/`HOST`/`PORT`/`USER`/`PASSWORD`/`DATABASE`/`PARAMS`),
 *     handed to `composeDbUrlFromResolver` so operators can store the
 *     connection parts as separate SSM/Secrets Manager parameters instead
 *     of a single pre-baked URL.
 *
 * The DBREAD_* prefix is intentionally distinct from db-codegen-mcp's DBGEN_*
 * so both servers can coexist in a single dotenv file pointing at different
 * environments / credentials.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { errorResponse, ToolRegistry, type ToolHandler } from "mcp-shared";
import { ssmConfigFromEnv, type BastionConfig, type TunnelSpec } from "mcp-shared/tunnel";
import {
  createDatabaseTools,
  type DataSource,
  type SelectableFieldsMap,
  type TableMetadataMap,
} from "mcp-shared-db";
import {
  detectLegacySelectableFieldsUsage,
  type LegacyUsageReport,
} from "mcp-shared-db-core";
import {
  composeDbUrlFromResolver,
  createSecretResolver,
  envSource,
  loadEnvFile,
  secretsManagerSource,
  ssmSource,
  type SecretResolver,
} from "mcp-shared-secrets";
import { parseArgs, type CliArgs } from "./cli.js";
import {
  loadMetadata,
  loadSelectableFields,
  type DynamicImport,
} from "./load-config.js";
import { pickEngineStrategy } from "./strategies/pick.js";
import { VERSION } from "./version.js";

export const SERVER_NAME = "db-read-mcp";
export const SERVER_VERSION = VERSION;

/** Env keys whose values are eagerly resolved during startup. */
export const SECRET_KEYS = [
  "DBREAD_URL",
  // Component-env alternative to DBREAD_URL — composed via composeDbUrlFromResolver.
  "DBREAD_DIALECT",
  "DBREAD_HOST",
  "DBREAD_PORT",
  "DBREAD_USER",
  "DBREAD_PASSWORD",
  "DBREAD_DATABASE",
  "DBREAD_PARAMS",
  "DBREAD_BASTION_HOST",
  "DBREAD_BASTION_KEY",
  "DBREAD_SSM_TARGET",
  "DBREAD_SSM_REGION",
  "DBREAD_SSM_PROFILE",
  "DBREAD_SSM_DOCUMENT_NAME",
  "DBREAD_SSM_READY_TIMEOUT_MS",
] as const;

/** Connection seam — lets tests stub the tunnel + driver construction. */
export interface ConnectParams {
  url: string;
  /**
   * Tunnel spec — either an SSH bastion or an AWS SSM port forward.
   * `null` means a direct connection (no tunnel).
   *
   * The two kinds are mutually exclusive at the type level (see
   * `TunnelSpec` from `mcp-shared`); pre-flight wiring (`buildTunnelConfig`)
   * runtime-rejects the case where both env signals are set.
   */
  tunnel: TunnelSpec | null;
  tableMetadata: TableMetadataMap;
}

export interface Connection {
  /** Wired DataSource — engine-specific (postgres, mysql, ...) decided by URL. */
  dataSource: DataSource;
  /** Teardown callback — closes tunnel + driver client on shutdown. */
  close: () => Promise<void>;
}

/**
 * Default connection opener. Dispatches to the engine strategy that matches
 * the URL scheme (postgres / mysql) and lets it own the engine-specific
 * wiring: driver instantiation, TLS warning text, startup `SET` statements,
 * and DataSource construction.
 *
 * Errors after the tunnel is up are the strategy's responsibility to clean
 * up before re-throwing — see `strategies/{pg,mysql}.ts`.
 */
export async function defaultOpenConnection(params: ConnectParams): Promise<Connection> {
  const strategy = pickEngineStrategy(params.url);
  // Loud nudge for the most common misconfiguration: skipping the tunnel
  // *and* the URL doesn't ask for TLS, so the wire is plain TCP.
  const warning = strategy.detectInsecureTls({
    url: params.url,
    tunnel: params.tunnel,
  });
  if (warning) console.error(warning);
  return strategy.open({
    url: params.url,
    tunnel: params.tunnel,
    tableMetadata: params.tableMetadata,
  });
}

export interface BuildDefaultResolverOptions {
  /** Override `process.env` lookup for AWS_PROFILE / AWS_REGION. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Build a resolver using the standard scheme set (`ssm:`, `sm:`, `env:`).
 * AWS profile/region come from the env (set them via `--env-file` or the shell).
 */
export function buildDefaultResolver(options: BuildDefaultResolverOptions = {}): SecretResolver {
  const env = options.env ?? process.env;
  const profile = env.AWS_PROFILE;
  const region = env.AWS_REGION;
  return createSecretResolver({
    schemes: {
      ssm: ssmSource({ ...(profile && { profile }), ...(region && { region }) }),
      sm: secretsManagerSource({
        ...(profile && { profile }),
        ...(region && { region }),
      }),
      env: envSource(),
    },
  });
}

/**
 * Build a `BastionConfig` from a resolver's pre-cached entries.
 *
 * Returns `null` when `DBREAD_BASTION_HOST` is unset (we treat null as
 * "no bastion → direct connection"). When `DBREAD_BASTION_KEY` is present we
 * attach it as `identityFile`; absent is allowed (e.g. ssh-agent).
 */
export function buildBastionConfig(resolver: SecretResolver): BastionConfig | null {
  const host = tryCached({ resolver, key: "DBREAD_BASTION_HOST" });
  if (host === undefined) return null;
  const identityFile = tryCached({ resolver, key: "DBREAD_BASTION_KEY" });
  return identityFile ? { host, identityFile } : { host };
}

/**
 * Build a `TunnelSpec` from a resolver's pre-cached entries, picking SSH
 * bastion or AWS SSM port forward based on which env signal is set.
 *
 *   - `DBREAD_BASTION_HOST` set → `{ bastion: ... }`
 *   - `DBREAD_SSM_TARGET` set   → `{ ssm: ... }`
 *   - both set                  → throw (operator must pick one)
 *   - neither                   → `null` (direct connection)
 *
 * The cached resolver layer handles the `ssm:` / `sm:` URI resolution
 * before this runs, so values are guaranteed to be plain strings here.
 *
 * `ssmConfigFromEnv` reads from `process.env`; we mirror cached resolver
 * values into env (if not already set) so it picks them up.
 */
export function buildTunnelConfig(resolver: SecretResolver): TunnelSpec | null {
  const bastion = buildBastionConfig(resolver);
  // ssmConfigFromEnv reads process.env directly; ensure cached values land
  // there for the read. Mirror only when env doesn't already define the key.
  for (const key of [
    "DBREAD_SSM_TARGET",
    "DBREAD_SSM_REGION",
    "DBREAD_SSM_PROFILE",
    "DBREAD_SSM_DOCUMENT_NAME",
    "DBREAD_SSM_READY_TIMEOUT_MS",
  ] as const) {
    if (process.env[key] === undefined) {
      const cached = tryCached({ resolver, key });
      if (cached !== undefined) process.env[key] = cached;
    }
  }
  const ssm = ssmConfigFromEnv("DBREAD");
  if (bastion && ssm) {
    throw new Error(
      "Set at most one of DBREAD_BASTION_HOST or DBREAD_SSM_TARGET, not both",
    );
  }
  if (bastion) return { bastion };
  if (ssm) return { ssm };
  return null;
}

interface TryCachedParams {
  resolver: SecretResolver;
  key: string;
}

/** Sync cache lookup that returns undefined instead of throwing for missing keys. */
function tryCached(params: TryCachedParams): string | undefined {
  try {
    return params.resolver.cached(params.key);
  } catch {
    return undefined;
  }
}

/** Cap on inline legacy-site listings before truncating with a count. */
const LEGACY_NUDGE_DISPLAY_CAP = 20;

interface FormatLegacyNudgeParams {
  report: LegacyUsageReport;
  filePath: string;
}

/**
 * Render the migration nudge for a legacy-usage report. Returns `null` when
 * there is nothing to report, so the caller can `if (msg) console.error(msg)`
 * without branching twice. Pure — exposed for unit testing.
 *
 * Long lists are truncated to {@link LEGACY_NUDGE_DISPLAY_CAP} entries with a
 * "(+N more)" suffix so a 200-field config doesn't flood the operator's
 * stderr.
 */
export function formatLegacySelectableFieldsNudge(
  params: FormatLegacyNudgeParams,
): string | null {
  const { report, filePath } = params;
  if (!report.hasLegacyUsage) return null;
  const total = report.entries.length;
  const shown = report.entries.slice(0, LEGACY_NUDGE_DISPLAY_CAP);
  const lines = shown.map((e) => `  - ${e.table}.${e.field} (${e.kind})`);
  if (total > shown.length) {
    lines.push(`  (+${total - shown.length} more)`);
  }
  return [
    `[db-read-mcp] WARNING: ${filePath} uses legacy 'pii'/'piiReason' fields.`,
    `Migrate to { select: "redact" | "expose" | "exclude", note: "..." } —`,
    `back-compat reader will keep accepting the old shape for now. Affected:`,
    ...lines,
  ].join("\n");
}

interface EmitLegacyNudgeParams {
  selectableFields: SelectableFieldsMap;
  filePath: string;
  /** Test seam — defaults to `console.error`. */
  log?: (msg: string) => void;
}

/** Run legacy detection on a loaded map and emit the nudge to stderr. */
export function emitLegacySelectableFieldsNudgeIfAny(
  params: EmitLegacyNudgeParams,
): void {
  const report = detectLegacySelectableFieldsUsage(params.selectableFields);
  const msg = formatLegacySelectableFieldsNudge({
    report,
    filePath: params.filePath,
  });
  if (msg !== null) (params.log ?? ((m) => console.error(m)))(msg);
}

export interface BuildReadToolsParams {
  selectableFields: SelectableFieldsMap;
  tableMetadata: TableMetadataMap;
  /** Lazy DataSource factory — invoked on each execute call. */
  getDataSource: () => Promise<DataSource>;
  /** Override the tool prefix (default: "db"). */
  toolPrefix?: string;
}

/**
 * Wrap `createDatabaseTools` so the launcher can register the pair on a
 * `ToolRegistry`. Pure forwarding — kept as a named export so tests can
 * exercise it without spinning up the full server.
 */
export function buildReadTools(params: BuildReadToolsParams): ToolHandler[] {
  return createDatabaseTools({
    selectableFields: params.selectableFields,
    tableMetadata: params.tableMetadata,
    getDataSource: params.getDataSource,
    ...(params.toolPrefix && { toolPrefix: params.toolPrefix }),
  });
}

export interface CreateServerWithDataSourceOptions {
  selectableFields: SelectableFieldsMap;
  tableMetadata: TableMetadataMap;
  getDataSource: () => Promise<DataSource>;
  toolPrefix?: string;
}

export function createServer(options: CreateServerWithDataSourceOptions): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  const registry = new ToolRegistry();
  const tools = buildReadTools({
    selectableFields: options.selectableFields,
    tableMetadata: options.tableMetadata,
    getDataSource: options.getDataSource,
    ...(options.toolPrefix && { toolPrefix: options.toolPrefix }),
  });
  for (const tool of tools) registry.register(tool);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.getAllTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const handler = registry.getHandler(request.params.name);
    if (!handler) return errorResponse(`Unknown tool: ${request.params.name}`);
    return handler.execute(request.params.arguments);
  });

  return server;
}

export interface StartServerOptions {
  /** Pre-parsed CLI arguments (preferred over re-parsing argv). */
  cli?: CliArgs;
  /** Pre-built resolver (test seam). When omitted, one is constructed internally. */
  resolver?: SecretResolver;
  /** Test seam: dotenv loader. Defaults to `loadEnvFile`. */
  loadEnvFile?: (path: string) => unknown;
  /** Test seam: dynamic importer used by load-config helpers. */
  importer?: DynamicImport;
  /** Test seam: opens the tunneled pg connection. Defaults to `defaultOpenConnection`. */
  openConnection?: (params: ConnectParams) => Promise<Connection>;
}

/**
 * Bootstrap and connect the MCP server.
 *
 * Steps:
 *   1. Load `--env-file` (required).
 *   2. Build (or accept injected) resolver and preload `SECRET_KEYS`.
 *   3. Dynamic-import `--metadata` and `--selectable-fields`.
 *   4. Resolve URL through SSH bastion (if configured), open `pg.Client`.
 *   5. Build DataSource → tools → register on server → connect Stdio.
 */
export async function startServer(
  argvOrOptions: readonly string[] | StartServerOptions,
): Promise<void> {
  const options = isStartServerOptions(argvOrOptions)
    ? argvOrOptions
    : ({ cli: parseArgs(argvOrOptions) } satisfies StartServerOptions);

  if (!options.cli) {
    throw new Error("startServer requires CLI arguments (envFile / metadata / selectableFields)");
  }
  const cli = options.cli;

  const load = options.loadEnvFile ?? loadEnvFile;
  load(cli.envFile);

  const resolver = options.resolver ?? buildDefaultResolver();
  await resolver.preload([...SECRET_KEYS]);

  const [tableMetadata, selectableFields] = await Promise.all([
    loadMetadata({
      filePath: cli.metadata,
      ...(options.importer && { importer: options.importer }),
    }),
    loadSelectableFields({
      filePath: cli.selectableFields,
      ...(options.importer && { importer: options.importer }),
    }),
  ]);

  // Secure-by-default migration nudge: surface any legacy pii/piiReason
  // usage so operators don't drift past the deprecation window. Warn-only;
  // the back-compat reader in mcp-shared-db-core still honors the old shape.
  emitLegacySelectableFieldsNudgeIfAny({
    selectableFields,
    filePath: cli.selectableFields,
  });

  const { url } = composeDbUrlFromResolver({ resolver, prefix: "DBREAD" });
  const tunnel = buildTunnelConfig(resolver);
  const opener = options.openConnection ?? defaultOpenConnection;
  const connection = await opener({ url, tunnel, tableMetadata });

  const server = createServer({
    selectableFields,
    tableMetadata,
    getDataSource: async () => connection.dataSource,
    ...(cli.toolPrefix && { toolPrefix: cli.toolPrefix }),
  });
  await server.connect(new StdioServerTransport());
  console.error(`${SERVER_NAME} v${SERVER_VERSION} started`);

  registerShutdownHooks(connection);
}

/**
 * Best-effort process-shutdown hook. Closes the underlying pg client + tunnel
 * when SIGINT/SIGTERM fires.
 *
 * Pulled out as a named export so tests can drive it without spinning up the
 * full server. We never invoke `connection.close()` in the happy path —
 * the Stdio transport keeps the parent process alive until it gets pipe
 * EOF, at which point Node's default behaviour walks the registered
 * once-listeners.
 */
export function registerShutdownHooks(connection: Connection): void {
  const shutdown = async (): Promise<void> => {
    try {
      await connection.close();
    } catch {
      // Swallow — we're already on the way out.
    }
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      void shutdown().finally(() => process.exit(0));
    });
  }
}

function isStartServerOptions(
  v: readonly string[] | StartServerOptions,
): v is StartServerOptions {
  return !Array.isArray(v);
}
