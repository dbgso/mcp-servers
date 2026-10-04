/**
 * What every SQL engine strategy shares: the open sequence (tunnel → client
 * → session setup, releasing whatever was acquired if a step throws) and the
 * `EngineConnection` that holds the wired-up DataSource plus the driver
 * client and optional tunnel that `close()` tears down (client first, then
 * tunnel).
 */
import type { DataSource } from "mcp-shared-db";
import type { RdbTableMetadataMap } from "mcp-shared-db-core";
import { resolveTunneledUrl, type ResolvedTunneledUrl } from "mcp-shared/tunnel";
import type { EngineConnection, OpenStrategyArgs } from "./types.js";

/** Driver client surface `close()` needs — both pg and mysql2 shims fit. */
export interface ClosableClient {
  end(): Promise<void>;
}

export interface SqlEngineConnectionConfig {
  dataSource: DataSource;
  client: ClosableClient;
  tunnel: ResolvedTunneledUrl["tunnel"];
}

export class SqlEngineConnection implements EngineConnection {
  readonly dataSource: DataSource;

  constructor(private readonly config: SqlEngineConnectionConfig) {
    this.dataSource = config.dataSource;
  }

  async close(): Promise<void> {
    await this.config.client.end();
    if (this.config.tunnel) await this.config.tunnel.close();
  }
}

/** The engine-specific steps of {@link openSqlConnection}. */
export interface SqlEngineSteps<C extends ClosableClient> {
  /** Build the driver client for the (possibly tunneled) URL. */
  createClient(url: string): Promise<C>;
  /** Connect, subscribe to async errors, and run the startup statements. */
  startSession(params: { client: C; env: NodeJS.ProcessEnv }): Promise<void>;
  /** Wire the DataSource on the ready client. */
  createDataSource(params: { client: C; tableMetadata: RdbTableMetadataMap }): DataSource;
}

/**
 * Open a SQL engine connection: bring up the tunnel (if any), build the
 * client, start the session, and wire the DataSource. If any step after the
 * tunnel throws, the client and tunnel acquired so far are released before
 * the original error is re-thrown (a failing teardown never masks it).
 */
export async function openSqlConnection<C extends ClosableClient>(params: {
  args: OpenStrategyArgs;
  steps: SqlEngineSteps<C>;
}): Promise<EngineConnection> {
  const { args, steps } = params;
  const { url, tunnel } = await resolveTunneledUrl({
    url: args.url,
    ...(args.tunnel && { tunnel: args.tunnel }),
  });
  let client: C | null = null;
  try {
    client = await steps.createClient(url);
    await steps.startSession({ client, env: args.env ?? process.env });
  } catch (err) {
    if (client) await client.end().catch(() => undefined);
    if (tunnel) await tunnel.close().catch(() => undefined);
    throw err;
  }
  const dataSource = steps.createDataSource({ client, tableMetadata: args.tableMetadata });
  return new SqlEngineConnection({ dataSource, client, tunnel });
}
