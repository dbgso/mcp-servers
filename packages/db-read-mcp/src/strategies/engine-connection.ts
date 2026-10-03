/**
 * `EngineConnection` shared by every engine strategy: holds the wired-up
 * DataSource plus the driver client and optional tunnel that `close()`
 * tears down (client first, then tunnel).
 */
import type { DataSource } from "mcp-shared-db";
import type { ResolvedTunneledUrl } from "mcp-shared/tunnel";
import type { EngineConnection } from "./types.js";

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

  close = async (): Promise<void> => {
    await this.config.client.end();
    if (this.config.tunnel) await this.config.tunnel.close();
  };
}
