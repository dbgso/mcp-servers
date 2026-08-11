/**
 * Engine-strategy interface used by `defaultOpenConnection`.
 *
 * Each implementation owns the engine-specific knowledge: which URL scheme
 * it accepts, how to detect insecure TLS configuration, and how to open the
 * connection (including driver instantiation, startup `SET` statements, and
 * DataSource wiring). Adding a new engine means dropping a new strategy
 * file in this directory and registering it in `pick.ts`.
 */
import type { DataSource } from "mcp-shared-db";
import type { RdbTableMetadataMap } from "mcp-shared-db-core";
import type { TunnelSpec } from "mcp-shared/tunnel";

export interface EngineConnection {
  dataSource: DataSource;
  close(): Promise<void>;
}

export interface DetectInsecureTlsArgs {
  url: string;
  /**
   * `null` when no tunnel is configured. Any tunnel kind (SSH bastion or
   * AWS SSM port forward) suppresses the "plaintext over the wire" warning,
   * because both kinds encrypt the hop the warning is about.
   */
  tunnel: TunnelSpec | null;
}

export interface OpenStrategyArgs {
  url: string;
  /** Tunnel spec — see `mcp-shared`'s `TunnelSpec`. `null` skips tunneling. */
  tunnel: TunnelSpec | null;
  tableMetadata: RdbTableMetadataMap;
  /** Defaults to `process.env`. Tests inject a stable map. */
  env?: NodeJS.ProcessEnv;
}

export interface EngineStrategy {
  /** Identifier used in error messages — e.g. `"postgres"` or `"mysql"`. */
  readonly engine: string;
  /** True when this strategy can handle the given URL. */
  matches(url: string): boolean;
  /**
   * Inspect the URL + tunnel combination and return a warning string if the
   * configuration leaves traffic unencrypted, or `null` if it's fine. The
   * caller is responsible for writing the warning to stderr.
   */
  detectInsecureTls(args: DetectInsecureTlsArgs): string | null;
  /**
   * Open the connection: build the driver client, run startup `SET`
   * statements, wire up the DataSource, and return both the DataSource and
   * a `close()` that tears down the client (and any tunnel) cleanly.
   *
   * Implementations must release the client + tunnel if the startup
   * sequence throws after they're acquired.
   */
  open(args: OpenStrategyArgs): Promise<EngineConnection>;
}
