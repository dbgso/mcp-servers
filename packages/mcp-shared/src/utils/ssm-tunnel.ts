/**
 * AWS SSM Session Manager port-forward tunnel helpers.
 *
 * Mirrors the SSH-tunnel API (`createSshTunnel` / `withSshTunnel`) but
 * spawns `aws ssm start-session --document-name AWS-StartPortForwardingSessionToRemoteHost`
 * instead of `ssh -L`. Targets private resources (RDS in a VPC, etc.) reachable
 * from an SSM-managed EC2 / ECS task without needing an SSH bastion.
 *
 * Requirements on the calling environment:
 *   - `aws` CLI on PATH (auth managed by the CLI's own config: SSO / profiles / IAM).
 *   - `session-manager-plugin` on PATH. The aws CLI shells out to this plugin
 *     to handle the WebSocket session; it is **not** bundled with the CLI.
 *     If missing, the CLI itself prints a clear error linking to AWS docs;
 *     we surface that stderr verbatim. We do **not** pre-detect with `which`.
 *   - The caller's IAM principal must have `ssm:StartSession` on the target
 *     instance + `ssmmessages:*`. Auth errors propagate as stderr.
 *
 * Cross-tunnel-kind infrastructure (free port allocation, port-readiness
 * probing, signal-handler registration) lives in `tunnel-common.ts` so SSH
 * and SSM tunnels share a single signal handler and a single registry of
 * live tunnels.
 */
import { type ChildProcess } from "node:child_process";
import {
  awaitTunnelReadyOrKill,
  ChildTunnelHandle,
  findFreePort,
  registerTunnel,
  spawnTunnelProcess,
  SpawnedTunnel,
  waitForPort,
} from "./tunnel-common.js";

/**
 * Local mirror of `buildAwsArgs` from `mcp-shared-secrets/aws/aws-exec.ts`.
 *
 * We deliberately don't take a workspace dep on `mcp-shared-secrets` here —
 * `mcp-shared` sits below it in the dependency graph and adding the link
 * would shift the lockfile (forbidden under the worktree-parallel rule).
 * The canonical impl is 10 lines of argv prefixing; mirroring it keeps both
 * tunnel kinds consistent without rotating shared infrastructure.
 *
 * If `mcp-shared-secrets` ever moves into `mcp-shared` (or both grow a
 * shared "aws-cli args" helper), collapse this back into the import.
 */
function buildAwsArgs(params: {
  args: readonly string[];
  options: AwsCliOptions;
}): string[] {
  return [...awsGlobalFlags(params.options), ...params.args];
}

/** Profile / region as the aws CLI wants them: global flags, before the subcommand. */
function awsGlobalFlags(options: AwsCliOptions): string[] {
  const out: string[] = [];
  if (options.profile) {
    out.push("--profile", options.profile);
  }
  if (options.region) {
    out.push("--region", options.region);
  }
  return out;
}

/** The two aws CLI globals this module ever sets. */
interface AwsCliOptions {
  profile?: string;
  region?: string;
}

/** ms to wait between SIGINT and SIGKILL fallback during graceful shutdown. */
const GRACEFUL_KILL_TIMEOUT_MS = 5_000;

/** Default cold-start budget. SSM is slower than SSH due to plugin + WebSocket setup. */
const DEFAULT_READY_TIMEOUT_MS = 15_000;

/** Default Systems Manager document for "forward a local port to a remote host". */
export const DEFAULT_SSM_DOCUMENT_NAME =
  "AWS-StartPortForwardingSessionToRemoteHost";

export interface SsmTunnelConfig {
  /** SSM target instance ID (e.g. `"i-0123abcd"`). */
  target: string;
  /** Remote host the SSM agent forwards traffic TO (typically an RDS endpoint). */
  remoteHost: string;
  /** Remote port. */
  remotePort: number;
  /** Local port to bind. Default: OS-assigned free port. */
  localPort?: number;
  /** Local bind host. Default: 127.0.0.1. */
  localBindHost?: string;
  /** AWS profile — passed as `--profile` CLI flag (NOT env inheritance). */
  profile?: string;
  /** AWS region — passed as `--region` CLI flag. */
  region?: string;
  /**
   * Override the SSM document name. Default
   * {@link DEFAULT_SSM_DOCUMENT_NAME}. Use
   * `"AWS-StartPortForwardingSession"` to forward a port on the target
   * instance itself instead of a remote host.
   */
  documentName?: string;
  /** Max wait for the local port to accept connections. Default 15s. */
  readyTimeoutMs?: number;
  /** ms between probe attempts. Default 200. */
  probeIntervalMs?: number;
  /** Override the spawn function for testing. */
  spawnFn?: (command: string, args: readonly string[]) => ChildProcess;
}

/**
 * Subset of {@link SsmTunnelConfig} that can be sourced from environment
 * variables. Excludes:
 *   - `remoteHost` / `remotePort` — derived from the URL by the caller.
 *   - `spawnFn` — test-only injection.
 *   - `localPort` / `localBindHost` / `probeIntervalMs` — managed by the
 *     URL-rewrite path (`resolveTunneledUrl`), not the env.
 *
 * Defined via `Omit` so adding fields to {@link SsmTunnelConfig} keeps this
 * surface in lock-step.
 */
export type SsmTunnelEnvConfig = Omit<
  SsmTunnelConfig,
  | "remoteHost"
  | "remotePort"
  | "spawnFn"
  | "localPort"
  | "localBindHost"
  | "probeIntervalMs"
>;

export interface SsmTunnel {
  /** Local port the tunnel is forwarding from. */
  readonly localPort: number;
  /** Local bind host. */
  readonly localBindHost: string;
  /** Whether the tunnel is still alive. */
  readonly active: boolean;
  /** Close the tunnel and kill the underlying aws CLI process. Idempotent. */
  close(): Promise<void>;
}

/**
 * Build the argv passed to `aws` for an SSM port-forward session.
 * Pure — exposed for testing and so callers can preview the command.
 *
 * Profile / region come through {@link buildAwsArgs} so they appear as
 * `--profile` / `--region` CLI flags ahead of the command-specific args,
 * matching the convention enforced by `mcp-shared-secrets/aws/aws-exec.ts`.
 */
export function buildSsmTunnelArgs(params: {
  target: string;
  remoteHost: string;
  remotePort: number;
  localPort: number;
  documentName?: string;
  profile?: string;
  region?: string;
}): string[] {
  return buildAwsArgs({
    args: ssmSessionArgs(params),
    options: {
      ...(params.profile && { profile: params.profile }),
      ...(params.region && { region: params.region }),
    },
  });
}

/**
 * The `start-session` invocation itself. `--parameters` is the document's own
 * encoding rather than a CLI convention, which is why it is built here and not
 * alongside the global flags.
 */
function ssmSessionArgs(params: {
  target: string;
  remoteHost: string;
  remotePort: number;
  localPort: number;
  documentName?: string;
}): string[] {
  return [
    "ssm",
    "start-session",
    "--target",
    params.target,
    "--document-name",
    params.documentName ?? DEFAULT_SSM_DOCUMENT_NAME,
    "--parameters",
    `host=${params.remoteHost},portNumber=${params.remotePort},localPortNumber=${params.localPort}`,
  ];
}

/**
 * Open an AWS SSM port-forward session.
 *
 * Resolves once the local port is accepting connections. The caller must
 * call `close()` to release the aws CLI child process (or use
 * `withSsmTunnel`).
 */
export async function createSsmTunnel(config: SsmTunnelConfig): Promise<SsmTunnel> {
  const localBindHost = config.localBindHost ?? "127.0.0.1";
  const localPort = config.localPort ?? (await findFreePort(localBindHost));

  const child = spawnTunnelProcess({
    command: "aws",
    args: ssmArgsFor({ config, localPort }),
    label: "ssm-tunnel",
    spawnFn: config.spawnFn,
  });

  const handle = new ChildTunnelHandle(child);
  registerTunnel(handle);
  const tunnel = new SsmProcessTunnel({ child, handle, localPort, localBindHost });

  await awaitTunnelReadyOrKill({
    child,
    handle,
    wait: () => awaitSsmReady({ config, child, localBindHost, localPort }),
  });

  return tunnel;
}

class SsmProcessTunnel extends SpawnedTunnel implements SsmTunnel {
  /**
   * SIGINT lets the aws CLI tell AWS to terminate the session and clean up
   * session-manager-plugin, so it isn't orphaned on the AWS side; SIGTERM
   * doesn't trigger that path. Escalate to SIGKILL after 5s so we never block
   * forever on a stuck plugin.
   */
  protected async shutdown(): Promise<void> {
    this.child.kill("SIGINT");
    await new Promise<void>((resolve) => {
      if (this.child.exitCode !== null) return resolve();
      const escalate = setTimeout(() => {
        this.child.kill("SIGKILL");
      }, GRACEFUL_KILL_TIMEOUT_MS);
      // Give the SIGKILL a brief grace too, then resolve regardless so we
      // don't leak a hung promise.
      const finalTimeout = setTimeout(() => resolve(), GRACEFUL_KILL_TIMEOUT_MS + 1_000);
      this.child.once("exit", () => {
        clearTimeout(escalate);
        clearTimeout(finalTimeout);
        resolve();
      });
    });
  }
}

function ssmArgsFor(params: {
  config: SsmTunnelConfig;
  localPort: number;
}): string[] {
  const { config } = params;
  return buildSsmTunnelArgs({
    target: config.target,
    remoteHost: config.remoteHost,
    remotePort: config.remotePort,
    localPort: params.localPort,
    ...(config.documentName && { documentName: config.documentName }),
    ...awsCliOverrides(config),
  });
}

/** Absent settings stay absent so the aws CLI falls back to its own config. */
function awsCliOverrides(config: AwsCliOptions): AwsCliOptions {
  return {
    ...(config.profile && { profile: config.profile }),
    ...(config.region && { region: config.region }),
  };
}

/** Timeouts are defaulted here so `createSsmTunnel` reads as lifecycle only. */
async function awaitSsmReady(params: {
  config: SsmTunnelConfig;
  child: ChildProcess;
  localBindHost: string;
  localPort: number;
}): Promise<void> {
  await waitForPort({
    host: params.localBindHost,
    port: params.localPort,
    timeoutMs: params.config.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
    intervalMs: params.config.probeIntervalMs ?? 200,
    child: params.child,
    childLabel: "aws ssm start-session",
  });
}

/**
 * Run `fn` with an SSM tunnel; close the tunnel (even on throw) before resolving.
 */
export async function withSsmTunnel<T>(params: {
  config: SsmTunnelConfig;
  fn: (tunnel: SsmTunnel) => Promise<T>;
}): Promise<T> {
  const tunnel = await createSsmTunnel(params.config);
  try {
    return await params.fn(tunnel);
  } finally {
    await tunnel.close();
  }
}

/**
 * Build an SSM tunnel config from environment variables. Returns `null`
 * when `<PREFIX>_SSM_TARGET` is unset.
 *
 * Conventions (with `prefix = "DBREAD"`):
 *   DBREAD_SSM_TARGET            — required (e.g. `"i-0123abcd"`)
 *   DBREAD_SSM_REGION            — optional (also fallback: `AWS_REGION`)
 *   DBREAD_SSM_PROFILE           — optional (also fallback: `AWS_PROFILE`)
 *   DBREAD_SSM_DOCUMENT_NAME     — optional override
 *   DBREAD_SSM_READY_TIMEOUT_MS  — optional integer ms
 *
 * Region / profile fall back to the standard AWS env names (`AWS_REGION` /
 * `AWS_PROFILE`) when the prefixed form isn't set, so callers running in an
 * environment that already exports those don't need to duplicate them.
 */
export function ssmConfigFromEnv(prefix: string): SsmTunnelEnvConfig | null {
  const target = process.env[`${prefix}_SSM_TARGET`];
  if (!target) return null;
  return {
    target,
    ...ssmCredentialsFromEnv(prefix),
    ...ssmSessionSettingsFromEnv(prefix),
  };
}

/** Who opens the session. */
function ssmCredentialsFromEnv(
  prefix: string,
): Pick<SsmTunnelEnvConfig, "region" | "profile"> {
  const settings: Pick<SsmTunnelEnvConfig, "region" | "profile"> = {};
  const region = awsRegionFromEnv(prefix);
  if (region) settings.region = region;
  const profile = awsProfileFromEnv(prefix);
  if (profile) settings.profile = profile;
  return settings;
}

/**
 * The prefixed name wins, then the standard AWS one: a caller in an environment
 * that already exports `AWS_REGION` shouldn't have to duplicate it.
 */
function awsRegionFromEnv(prefix: string): string | undefined {
  return process.env[`${prefix}_SSM_REGION`] ?? process.env.AWS_REGION;
}

/** Same fallback as {@link awsRegionFromEnv}, for `AWS_PROFILE`. */
function awsProfileFromEnv(prefix: string): string | undefined {
  return process.env[`${prefix}_SSM_PROFILE`] ?? process.env.AWS_PROFILE;
}

/** How the session behaves, as opposed to who opens it. */
function ssmSessionSettingsFromEnv(
  prefix: string,
): Pick<SsmTunnelEnvConfig, "documentName" | "readyTimeoutMs"> {
  const settings: Pick<
    SsmTunnelEnvConfig,
    "documentName" | "readyTimeoutMs"
  > = {};
  const documentName = process.env[`${prefix}_SSM_DOCUMENT_NAME`];
  if (documentName) settings.documentName = documentName;
  const readyTimeoutMs = readyTimeoutFromEnv(prefix);
  if (readyTimeoutMs) settings.readyTimeoutMs = readyTimeoutMs;
  return settings;
}

function readyTimeoutFromEnv(prefix: string): number | undefined {
  const raw = process.env[`${prefix}_SSM_READY_TIMEOUT_MS`];
  if (!raw) return undefined;
  return positiveMillis(Number(raw));
}

/** A garbage or non-positive timeout is ignored rather than applied as-is. */
function positiveMillis(value: number): number | undefined {
  if (Number.isFinite(value) && value > 0) return Math.round(value);
  return undefined;
}
