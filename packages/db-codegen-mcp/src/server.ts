/**
 * Thin MCP server wrapper around `mcp-shared-db-codegen`.
 *
 * Wires the Stdio transport, builds the codegen describe/execute tool pair,
 * and registers the pair on a stock `ToolRegistry`.
 *
 * Secrets resolution:
 *   - Optionally loads a dotenv file (`--env-file <path>`) at startup.
 *   - Constructs a `mcp-shared-secrets` resolver with `ssm:`, `sm:`, `env:`
 *     schemes registered.
 *   - Eagerly preloads `DBGEN_URL` / `DBGEN_BASTION_HOST` / `DBGEN_BASTION_KEY`
 *     so the codegen tools can read them via the synchronous `cached(...)` API.
 *   - Also preloads the per-component alternative
 *     (`DBGEN_DIALECT`/`HOST`/`PORT`/`USER`/`PASSWORD`/`DATABASE`/`PARAMS`),
 *     composed via `composeDbUrlFromResolver` so operators can store the
 *     connection parts as separate SSM/Secrets Manager parameters instead
 *     of a single pre-baked URL.
 *
 * The server intentionally does not register itself in `.mcp.json` — the
 * caller must opt-in by setting `DBGEN_URL` (or the component env set).
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
  createCodegenTools,
  type CreateCodegenToolsConfig,
} from "mcp-shared-db-codegen";
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
import { VERSION } from "./version.js";

export const SERVER_NAME = "db-codegen-mcp";
export const SERVER_VERSION = VERSION;

/** Env keys whose values are eagerly resolved during startup. */
export const SECRET_KEYS = [
  "DBGEN_URL",
  // Component-env alternative to DBGEN_URL — composed via composeDbUrlFromResolver.
  "DBGEN_DIALECT",
  "DBGEN_HOST",
  "DBGEN_PORT",
  "DBGEN_USER",
  "DBGEN_PASSWORD",
  "DBGEN_DATABASE",
  "DBGEN_PARAMS",
  "DBGEN_BASTION_HOST",
  "DBGEN_BASTION_KEY",
  "DBGEN_SSM_TARGET",
  "DBGEN_SSM_REGION",
  "DBGEN_SSM_PROFILE",
  "DBGEN_SSM_DOCUMENT_NAME",
  "DBGEN_SSM_READY_TIMEOUT_MS",
] as const;

export interface CreateServerOptions {
  /** Override the codegen tool config. Defaults to resolver-driven `DBGEN_URL`. */
  toolsConfig?: Partial<CreateCodegenToolsConfig>;
}

export interface StartServerOptions extends CreateServerOptions {
  /** Pre-parsed CLI arguments (preferred over re-parsing argv inside startServer). */
  cli?: CliArgs;
  /** Pre-built resolver (test seam). When omitted, one is constructed internally. */
  resolver?: SecretResolver;
  /** Test seam: dotenv loader. Defaults to `loadEnvFile`. */
  loadEnvFile?: (path: string) => unknown;
}

/**
 * Build a resolver using the standard scheme set (`ssm:`, `sm:`, `env:`).
 *
 * AWS profile/region are read from `AWS_PROFILE` / `AWS_REGION` (set them in
 * the dotenv file or the shell). The aws CLI itself is invoked via execFile —
 * SSO/IAM session management is fully delegated to the CLI.
 */
export function buildDefaultResolver(): SecretResolver {
  const profile = process.env.AWS_PROFILE;
  const region = process.env.AWS_REGION;
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
 * Returns `null` when `DBGEN_BASTION_HOST` is unset (codegen layer treats
 * `null` as "no bastion → direct connection"). When `DBGEN_BASTION_KEY` is
 * present we attach it as `identityFile`; absent is allowed (e.g. ssh-agent).
 */
export function buildBastionConfig(resolver: SecretResolver): BastionConfig | null {
  const host = tryCached({ resolver, key: "DBGEN_BASTION_HOST" });
  if (host === undefined) return null;
  const identityFile = tryCached({ resolver, key: "DBGEN_BASTION_KEY" });
  return identityFile ? { host, identityFile } : { host };
}

/**
 * Build a `TunnelSpec` from a resolver's pre-cached entries, picking SSH
 * bastion or AWS SSM port forward based on which env signal is set. Throws
 * when both are set.
 */
export function buildTunnelConfig(resolver: SecretResolver): TunnelSpec | null {
  const bastion = buildBastionConfig(resolver);
  // Mirror cached SSM keys into process.env so ssmConfigFromEnv reads them.
  for (const key of [
    "DBGEN_SSM_TARGET",
    "DBGEN_SSM_REGION",
    "DBGEN_SSM_PROFILE",
    "DBGEN_SSM_DOCUMENT_NAME",
    "DBGEN_SSM_READY_TIMEOUT_MS",
  ] as const) {
    if (process.env[key] === undefined) {
      const cached = tryCached({ resolver, key });
      if (cached !== undefined) process.env[key] = cached;
    }
  }
  const ssm = ssmConfigFromEnv("DBGEN");
  if (bastion && ssm) {
    throw new Error(
      "Set at most one of DBGEN_BASTION_HOST or DBGEN_SSM_TARGET, not both",
    );
  }
  if (bastion) return { bastion };
  if (ssm) return { ssm };
  return null;
}

/** Sync cache lookup that returns undefined instead of throwing for missing keys. */
function tryCached(params: { resolver: SecretResolver; key: string }): string | undefined {
  const { resolver, key } = params;
  try {
    return resolver.cached(key);
  } catch {
    return undefined;
  }
}

interface TryComposeDbUrlParams {
  resolver: SecretResolver;
  prefix: string;
}

/**
 * Compose a DB URL from preloaded resolver cache; returns undefined when
 * neither the `<P>_URL` fallback nor the full component set is available.
 * Lets the codegen tool layer surface "URL not configured" at call time
 * instead of failing startup.
 */
function tryComposeDbUrl(params: TryComposeDbUrlParams): string | undefined {
  try {
    return composeDbUrlFromResolver({ resolver: params.resolver, prefix: params.prefix }).url;
  } catch {
    return undefined;
  }
}

function resolveToolsConfig(params: {
  resolver: SecretResolver;
  override?: Partial<CreateCodegenToolsConfig>;
}): CreateCodegenToolsConfig {
  const { resolver, override = {} } = params;
  const merged: CreateCodegenToolsConfig = {
    getUrl: override.getUrl ?? (() => tryComposeDbUrl({ resolver, prefix: "DBGEN" }) ?? ""),
  };
  if (override.getTunnel) {
    merged.getTunnel = override.getTunnel;
  } else if (override.getBastion) {
    merged.getBastion = override.getBastion;
  } else {
    // Default: dispatch by env signal (DBGEN_BASTION_HOST vs DBGEN_SSM_TARGET).
    merged.getTunnel = () => buildTunnelConfig(resolver);
  }
  if (override.envPrefix) merged.envPrefix = override.envPrefix;
  if (override.toolPrefix) merged.toolPrefix = override.toolPrefix;
  if (override.describeDescription) merged.describeDescription = override.describeDescription;
  if (override.executeDescription) merged.executeDescription = override.executeDescription;
  if (override.preamble) merged.preamble = override.preamble;
  if (override.pickIntrospector) merged.pickIntrospector = override.pickIntrospector;
  return merged;
}

export interface BuildCodegenToolsOptions {
  resolver: SecretResolver;
  override?: Partial<CreateCodegenToolsConfig>;
}

export function buildCodegenTools(options: BuildCodegenToolsOptions): ToolHandler[] {
  return createCodegenTools(
    resolveToolsConfig({ resolver: options.resolver, override: options.override }),
  );
}

export interface CreateServerWithResolverOptions extends CreateServerOptions {
  resolver: SecretResolver;
}

export function createServer(options: CreateServerWithResolverOptions): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  const registry = new ToolRegistry();
  const tools = buildCodegenTools({
    resolver: options.resolver,
    ...(options.toolsConfig && { override: options.toolsConfig }),
  });
  for (const tool of tools) {
    registry.register(tool);
  }

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

/**
 * Bootstrap and connect the MCP server.
 *
 * Steps (in order):
 *   1. Optionally load `--env-file` (so resolver can see those vars).
 *   2. Build (or accept injected) resolver.
 *   3. Preload `SECRET_KEYS` so codegen tools can read sync via `cached(...)`.
 *   4. Construct server, register tools, connect Stdio transport.
 */
export async function startServer(
  argvOrOptions: readonly string[] | StartServerOptions = [],
): Promise<void> {
  const options = isStartServerOptions(argvOrOptions)
    ? argvOrOptions
    : ({ cli: parseArgs(argvOrOptions) } satisfies StartServerOptions);

  const cli = options.cli ?? {};
  const load = options.loadEnvFile ?? loadEnvFile;
  if (cli.envFile) load(cli.envFile);

  const resolver = options.resolver ?? buildDefaultResolver();
  await resolver.preload([...SECRET_KEYS]);

  const server = createServer({
    resolver,
    ...(options.toolsConfig && { toolsConfig: options.toolsConfig }),
  });
  await server.connect(new StdioServerTransport());
  console.error(`${SERVER_NAME} v${SERVER_VERSION} started`);
}

function isStartServerOptions(
  v: readonly string[] | StartServerOptions,
): v is StartServerOptions {
  return !Array.isArray(v);
}
