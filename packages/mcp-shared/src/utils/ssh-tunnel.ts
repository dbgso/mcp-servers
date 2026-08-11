/**
 * SSH bastion tunnel helpers.
 *
 * Two usage patterns are supported:
 *
 *   1. Explicit lifecycle:
 *        const tunnel = await createSshTunnel({...});
 *        try { /* connect to localhost:tunnel.localPort *\/ }
 *        finally { await tunnel.close(); }
 *
 *   2. Scoped (auto-close) — preferred when the work is bounded:
 *        await withSshTunnel({ config: {...}, fn: async (tunnel) => { ... } });
 *
 *   3. URL-rewrite — when callers express their target as a connection URL
 *      and only need the URL transparently rerouted through the bastion
 *      (or AWS SSM port forward — see `tunnel-common.ts` and `ssm-tunnel.ts`):
 *        const { url, tunnel } = await resolveTunneledUrl({ url, tunnel: { bastion } });
 *
 * Cross-tunnel-kind infrastructure (`findFreePort`, `waitForPort`, the
 * live-tunnel registry, signal handlers) lives in `tunnel-common.ts` so a
 * single SIGINT / SIGTERM tears down every tunnel regardless of kind.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  expandHome,
  findFreePort,
  isLoopbackHost,
  registerTunnel,
  unregisterTunnel,
  waitForPort,
  type TunnelHandle,
} from "./tunnel-common.js";
import type { SsmTunnelEnvConfig } from "./ssm-tunnel.js";
import { createSsmTunnel, type SsmTunnel } from "./ssm-tunnel.js";

// Re-export common helpers so existing callers that imported them from this
// module keep working unchanged.
export {
  expandHome,
  findFreePort,
  isLoopbackHost,
  isPortAcceptingConnections,
} from "./tunnel-common.js";

export interface SshTunnelConfig {
  /** SSH user@host or host. */
  bastionHost: string;
  /** Path to identity file (`-i`). Leading `~` is expanded. Optional. */
  identityFile?: string;
  /** Local port to bind. Default: OS-assigned free port. */
  localPort?: number;
  /** Local bind host. Default: 127.0.0.1. Use 0.0.0.0 to share the tunnel. */
  localBindHost?: string;
  /** Remote target host. */
  remoteHost: string;
  /** Remote target port. */
  remotePort: number;
  /** Extra args appended to the ssh command (e.g. ["-o", "ServerAliveInterval=30"]). */
  extraSshArgs?: string[];
  /** Max wait for the local port to accept connections. Default 10s. */
  readyTimeoutMs?: number;
  /** ms between probe attempts. Default 200. */
  probeIntervalMs?: number;
  /**
   * Override the spawn function for testing. Default is `child_process.spawn`.
   */
  spawnFn?: (command: string, args: readonly string[]) => ChildProcess;
}

export interface SshTunnel {
  /** Local port the tunnel is forwarding from. */
  readonly localPort: number;
  /** Local bind host. */
  readonly localBindHost: string;
  /** Whether the tunnel is still alive. */
  readonly active: boolean;
  /** Close the tunnel and kill the underlying SSH process. Idempotent. */
  close(): Promise<void>;
}

/**
 * Build the argv passed to `ssh` for a `-L` port forward in non-interactive mode.
 * Pure function — exposed for testing and so callers can preview the command.
 */
export function buildSshArgs(params: {
  bastionHost: string;
  identityFile?: string;
  localBindHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  extraSshArgs?: string[];
}): string[] {
  const args: string[] = [];
  if (params.identityFile) {
    args.push("-i", expandHome(params.identityFile));
  }
  // Standard non-interactive flags: no shell, no agent forwarding, no TTY,
  // exit on tunnel error.
  args.push(
    "-N",
    "-T",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
  );
  // Non-loopback bind addresses (e.g. 0.0.0.0) need `-g` so other hosts can
  // connect to the forwarded port. Without it ssh silently restricts the
  // forward to localhost regardless of the bind_address.
  if (!isLoopbackHost(params.localBindHost)) {
    args.push("-g");
  }
  args.push(
    "-L",
    `${params.localBindHost}:${params.localPort}:${params.remoteHost}:${params.remotePort}`,
  );
  if (params.extraSshArgs) args.push(...params.extraSshArgs);
  args.push(params.bastionHost);
  return args;
}

/**
 * Open an SSH `-L` port forward to a bastion.
 *
 * Resolves once the local port is accepting connections. The caller must call
 * `close()` to release the SSH child process (or use `withSshTunnel`).
 */
export async function createSshTunnel(config: SshTunnelConfig): Promise<SshTunnel> {
  const localBindHost = config.localBindHost ?? "127.0.0.1";
  const localPort = config.localPort ?? (await findFreePort(localBindHost));
  const args = buildSshArgs({
    bastionHost: config.bastionHost,
    ...(config.identityFile && { identityFile: config.identityFile }),
    localBindHost,
    localPort,
    remoteHost: config.remoteHost,
    remotePort: config.remotePort,
    ...(config.extraSshArgs && { extraSshArgs: config.extraSshArgs }),
  });

  const spawnFn = config.spawnFn ?? spawn;
  const child = spawnFn("ssh", args);
  child.unref?.();

  // Surface ssh stderr to the parent so authentication failures are visible.
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[ssh-tunnel] ${chunk}`);
  });

  let active = true;
  const handle: TunnelHandle = { kill: () => child.kill() };
  registerTunnel(handle);

  child.once("exit", () => {
    active = false;
    unregisterTunnel(handle);
  });

  try {
    // Always probe via loopback: a 0.0.0.0 listener is reachable on 127.0.0.1
    // too, and 0.0.0.0 is not a valid connect target (it means "any interface"
    // only in the listen context).
    await waitForPort({
      host: isLoopbackHost(localBindHost) ? localBindHost : "127.0.0.1",
      port: localPort,
      timeoutMs: config.readyTimeoutMs ?? 10_000,
      intervalMs: config.probeIntervalMs ?? 200,
      child,
      childLabel: "ssh",
    });
  } catch (err) {
    child.kill();
    unregisterTunnel(handle);
    throw err;
  }

  return {
    localPort,
    localBindHost,
    get active() {
      return active;
    },
    async close() {
      if (!active) return;
      active = false;
      unregisterTunnel(handle);
      child.kill();
      // Wait briefly for child to exit so callers can be sure the port is freed.
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        const timeout = setTimeout(() => resolve(), 1_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    },
  };
}

/**
 * Run `fn` with an SSH tunnel; close the tunnel (even on throw) before resolving.
 */
export async function withSshTunnel<T>(params: {
  config: SshTunnelConfig;
  fn: (tunnel: SshTunnel) => Promise<T>;
}): Promise<T> {
  const tunnel = await createSshTunnel(params.config);
  try {
    return await params.fn(tunnel);
  } finally {
    await tunnel.close();
  }
}

export interface BastionConfig {
  host: string;
  identityFile?: string;
  extraSshArgs?: string[];
}

/**
 * Discriminated union covering all tunnel kinds supported by
 * `resolveTunneledUrl`. Caller picks one variant; the type system enforces
 * mutual exclusion (no runtime check needed).
 */
export type TunnelSpec =
  | { bastion: BastionConfig }
  | { ssm: SsmTunnelEnvConfig };

/**
 * Cross-tunnel-kind opener input. Every tunnel implementation opens with the
 * same set of "where to bind locally / where to forward to" knobs; what
 * differs is the kind-specific config (carried by the closure).
 */
export interface TunnelOpenerOpts {
  localBindHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  readyTimeoutMs?: number;
  spawnFn?: SshTunnelConfig["spawnFn"];
}

/**
 * A function that opens a tunnel given the common opts. Each `TunnelSpec`
 * variant has a corresponding opener; `pickTunnelOpener` is the dispatch
 * table that maps kind → opener.
 */
export type TunnelOpener = (
  opts: TunnelOpenerOpts,
) => Promise<SshTunnel | SsmTunnel>;

/**
 * Build an opener that opens an SSH tunnel through the given bastion. The
 * returned closure carries the bastion config; callers supply the common
 * "where to forward" opts at open time.
 */
export function bastionTunnelOpener(bastion: BastionConfig): TunnelOpener {
  return (opts) =>
    createSshTunnel({
      bastionHost: bastion.host,
      ...(bastion.identityFile && { identityFile: bastion.identityFile }),
      ...(bastion.extraSshArgs && { extraSshArgs: bastion.extraSshArgs }),
      localBindHost: opts.localBindHost,
      localPort: opts.localPort,
      remoteHost: opts.remoteHost,
      remotePort: opts.remotePort,
      ...(opts.readyTimeoutMs !== undefined && {
        readyTimeoutMs: opts.readyTimeoutMs,
      }),
      ...(opts.spawnFn && { spawnFn: opts.spawnFn }),
    });
}

/**
 * Build an opener that opens an AWS SSM port-forward session. The
 * returned closure carries the SSM env config; callers supply the common
 * opts at open time.
 */
export function ssmTunnelOpener(ssm: SsmTunnelEnvConfig): TunnelOpener {
  return (opts) =>
    createSsmTunnel({
      ...ssm,
      remoteHost: opts.remoteHost,
      remotePort: opts.remotePort,
      localPort: opts.localPort,
      ...(opts.readyTimeoutMs !== undefined && {
        readyTimeoutMs: opts.readyTimeoutMs,
      }),
      ...(opts.spawnFn && { spawnFn: opts.spawnFn }),
    });
}

/**
 * Map a {@link TunnelSpec} to its opener. Single source of truth for
 * tunnel-kind dispatch — adding a new variant is one branch here +
 * one new opener factory.
 */
export function pickTunnelOpener(spec: TunnelSpec): TunnelOpener {
  if ("bastion" in spec) return bastionTunnelOpener(spec.bastion);
  return ssmTunnelOpener(spec.ssm);
}

export interface ResolveTunneledUrlParams {
  /** Remote connection URL (e.g. postgres://user:pass@db-host:5432/db). */
  url: string;
  /** Tunnel kind + config. Omit (or pass undefined) to skip tunneling. */
  tunnel?: TunnelSpec;
  /** Local port for the tunnel. Default: auto-allocate. */
  localPort?: number;
  /** Local bind host. Default 127.0.0.1. */
  localBindHost?: string;
  /** ms to wait for tunnel readiness. Default 10s (SSH) / 15s (SSM). */
  readyTimeoutMs?: number;
  /** Spawn override (testing). */
  spawnFn?: SshTunnelConfig["spawnFn"];
}

export interface ResolvedTunneledUrl {
  /** URL rewritten to point at the tunnel (or the original if no tunnel). */
  url: string;
  /** Tunnel handle. Undefined when no tunnel was needed. */
  tunnel?: SshTunnel | SsmTunnel;
}

/**
 * Resolve a remote connection URL through an optional tunnel.
 *
 * If `tunnel` is omitted, returns the URL unchanged. Otherwise opens a
 * tunnel of the requested kind (SSH bastion / AWS SSM port forward) via
 * the opener selected by {@link pickTunnelOpener} and returns a URL
 * pointing at the local tunnel endpoint. The URL's userinfo, path, query,
 * and fragment are preserved verbatim.
 */
export async function resolveTunneledUrl(
  params: ResolveTunneledUrlParams,
): Promise<ResolvedTunneledUrl> {
  if (!params.tunnel) {
    return { url: params.url };
  }

  const parsed = new URL(params.url);
  const remoteHost = parsed.hostname;
  const remotePort = parsed.port ? Number(parsed.port) : NaN;
  if (Number.isNaN(remotePort)) {
    throw new Error(
      `resolveTunneledUrl requires an explicit port in the URL (got: ${params.url})`,
    );
  }

  const localBindHost = params.localBindHost ?? "127.0.0.1";
  const localPort = params.localPort ?? (await findFreePort(localBindHost));

  // Polymorphic dispatch on tunnel kind. The opener closure encapsulates
  // the kind-specific config; this layer only deals with the common
  // "where to bind / where to forward" opts and the URL rewrite.
  const tunnel = await pickTunnelOpener(params.tunnel)({
    localBindHost,
    localPort,
    remoteHost,
    remotePort,
    ...(params.readyTimeoutMs !== undefined && {
      readyTimeoutMs: params.readyTimeoutMs,
    }),
    ...(params.spawnFn && { spawnFn: params.spawnFn }),
  });

  parsed.hostname = localBindHost;
  parsed.port = String(localPort);
  return { url: parsed.toString(), tunnel };
}

/**
 * Build a bastion tunnel config from environment variables.
 *
 * Conventions (with `prefix = "MYAPP"`):
 *   MYAPP_BASTION_HOST       — required (e.g. "ec2-user@1.2.3.4")
 *   MYAPP_BASTION_KEY        — optional path to identity file
 *   MYAPP_BASTION_EXTRA_ARGS — optional space-separated extra ssh args
 */
export function bastionConfigFromEnv(prefix: string): BastionConfig | null {
  const env = process.env;
  const host = env[`${prefix}_BASTION_HOST`];
  if (!host) return null;
  const identityFile = env[`${prefix}_BASTION_KEY`];
  const extraArgs = env[`${prefix}_BASTION_EXTRA_ARGS`];
  const config: BastionConfig = { host };
  if (identityFile) config.identityFile = identityFile;
  if (extraArgs) config.extraSshArgs = extraArgs.split(/\s+/).filter(Boolean);
  return config;
}
