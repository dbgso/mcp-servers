/**
 * Tunnel infrastructure shared across SSH bastion and AWS SSM port-forward
 * implementations.
 *
 * This module owns the cross-tunnel-kind concerns:
 *   - free-port allocation (`findFreePort`)
 *   - port-readiness probing (`waitForPort`, `isPortAcceptingConnections`)
 *   - parent-process exit + signal cleanup of all live tunnels
 *   - host string helpers (`expandHome`, `isLoopbackHost`)
 *
 * Both `ssh-tunnel.ts` and `ssm-tunnel.ts` register their child processes
 * here so a single SIGINT / SIGTERM tears every tunnel down regardless of
 * kind. Idempotent — safe to import from multiple sites.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, Socket } from "node:net";
import { homedir } from "node:os";
import path from "node:path";

/** Expand a leading `~` in a path to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

/**
 * Loopback hosts that don't require special tooling flags for `-L` style
 * port forwarding to work. Useful for both SSH `-L` and SSM port forward
 * probes.
 */
export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/** Find a free TCP port by listening on 0 and reading the assigned port. */
export async function findFreePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen({ port: 0, host }, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => {
        if (port === 0) reject(new Error("Failed to allocate free port"));
        else resolve(port);
      });
    });
  });
}

/** Probe whether the given host:port is accepting TCP connections. */
export async function isPortAcceptingConnections(params: {
  host: string;
  port: number;
  timeoutMs?: number;
}): Promise<boolean> {
  const { host, port, timeoutMs = 500 } = params;
  return new Promise((resolve) => {
    const socket = new Socket();
    const finish = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
    socket.once("connect", () => finish(true));
    socket.connect(port, host);
  });
}

/**
 * Block until `host:port` accepts a TCP connection, or `timeoutMs` elapses.
 *
 * The `child` parameter lets the caller surface an early failure: if the
 * tunnel process dies before the port comes up, the loop exits with a
 * specific error rather than waiting out the timeout. The error label
 * (`"ssh"` / `"aws ssm start-session"` / etc.) is interpolated so the
 * caller's message reads naturally.
 */
export async function waitForPort(params: {
  host: string;
  port: number;
  timeoutMs: number;
  intervalMs: number;
  child: ChildProcess;
  /** Tool name interpolated into error messages. Default: `"tunnel process"`. */
  childLabel?: string;
}): Promise<void> {
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() < deadline) {
    if (await tunnelPortReady(params)) return;
    await new Promise((r) => setTimeout(r, params.intervalMs));
  }
  throw new Error(
    `Timeout waiting for tunnel on ${params.host}:${params.port} after ${params.timeoutMs}ms`,
  );
}

/**
 * One readiness attempt, named so `waitForPort`'s loop shows only the two ways
 * out: the port answered, or the deadline passed.
 */
async function tunnelPortReady(params: {
  host: string;
  port: number;
  child: ChildProcess;
  childLabel?: string;
}): Promise<boolean> {
  if (params.child.exitCode !== null) {
    const label = params.childLabel ?? "tunnel process";
    throw new Error(
      `${label} exited before tunnel was ready (exit code ${params.child.exitCode})`,
    );
  }
  return isPortAcceptingConnections({ host: params.host, port: params.port });
}

/**
 * Spawn a tunnel process with its stderr relayed to the parent.
 *
 * Both tunnel kinds shell out to a tool that manages its own authentication,
 * so this is the one place that decides how such a child is launched.
 */
export function spawnTunnelProcess(params: {
  command: string;
  args: readonly string[];
  /** Prefix for relayed stderr lines, e.g. `"ssh-tunnel"`. */
  label: string;
  /** Override for testing. Default is `child_process.spawn`. */
  spawnFn?: (command: string, args: readonly string[]) => ChildProcess;
}): ChildProcess {
  const child = (params.spawnFn ?? spawn)(params.command, params.args);
  child.unref?.();
  relayStderr({ child, label: params.label });
  return child;
}

/**
 * ssh and the aws CLI both explain their own failures on stderr — a rejected
 * key, a missing session-manager-plugin. Swallowing it would leave the caller
 * with a readiness timeout and no reason for it.
 */
function relayStderr(params: { child: ChildProcess; label: string }): void {
  params.child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[${params.label}] ${chunk.toString()}`);
  });
}

/**
 * Process registration handle. Each tunnel implementation calls
 * `registerTunnel(handle)` after spawning its child process and
 * `unregisterTunnel(handle)` when the tunnel closes (or the child exits).
 *
 * On parent process exit (SIGINT / SIGTERM / normal exit) every registered
 * handle's `kill()` runs so no tunnel process is orphaned.
 */
export interface TunnelHandle {
  kill(): void;
}

/**
 * The only handle either tunnel kind needs: both own a child process, and the
 * registry only ever asks a handle to kill it.
 */
export class ChildTunnelHandle implements TunnelHandle {
  constructor(private readonly child: ChildProcess) {}

  kill(): void {
    this.child.kill();
  }
}

const liveTunnels = new Set<TunnelHandle>();

let exitHandlersInstalled = false;

/**
 * Register an exit/signal handler that kills every live tunnel. Idempotent
 * — safe to call from each tunnel kind's startup path.
 */
export function ensureExitHandlersInstalled(): void {
  if (exitHandlersInstalled) return;
  exitHandlersInstalled = true;
  // Synchronous best-effort cleanup on hard exit.
  process.on("exit", () => {
    for (const t of liveTunnels) t.kill();
  });
  // Ctrl-C / SIGTERM: kill tunnels then re-raise so the default action runs.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      for (const t of liveTunnels) t.kill();
      // Re-emit by signaling self with the conventional 128 + signo exit code.
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
}

export function registerTunnel(handle: TunnelHandle): void {
  liveTunnels.add(handle);
  ensureExitHandlersInstalled();
}

export function unregisterTunnel(handle: TunnelHandle): void {
  liveTunnels.delete(handle);
}

/**
 * Everything a tunnel is, minus how it shuts down.
 *
 * Both kinds forward a local endpoint through a child process and are "active"
 * until either side ends it; they differ only in how the child has to be taken
 * down, which is what {@link SpawnedTunnel.shutdown} names. Keeping the
 * bookkeeping here is what makes `close()` idempotent in one place rather than
 * two.
 */
export abstract class SpawnedTunnel {
  readonly localPort: number;
  readonly localBindHost: string;
  protected readonly child: ChildProcess;
  private readonly handle: TunnelHandle;
  private alive = true;

  constructor(params: {
    child: ChildProcess;
    handle: TunnelHandle;
    localPort: number;
    localBindHost: string;
  }) {
    this.child = params.child;
    this.handle = params.handle;
    this.localPort = params.localPort;
    this.localBindHost = params.localBindHost;
    // The child can die without us asking — a dropped connection, a killed
    // session. Owning the handler here is what keeps `active` honest whichever
    // side ended it, and stops the registry holding a dead process.
    this.child.once("exit", () => {
      this.alive = false;
      unregisterTunnel(this.handle);
    });
  }

  get active(): boolean {
    return this.alive;
  }

  async close(): Promise<void> {
    if (!this.alive) return;
    this.alive = false;
    unregisterTunnel(this.handle);
    await this.shutdown();
  }

  protected abstract shutdown(): Promise<void>;
}

/**
 * Await readiness, and take the child down if it never arrives.
 *
 * A tunnel that failed to come up must not be left in the live registry, or
 * the exit handlers would later kill a process nobody is waiting on.
 */
export async function awaitTunnelReadyOrKill(params: {
  child: ChildProcess;
  handle: TunnelHandle;
  wait: () => Promise<void>;
}): Promise<void> {
  try {
    await params.wait();
  } catch (err) {
    params.child.kill();
    unregisterTunnel(params.handle);
    throw err;
  }
}

/**
 * Test-only accessor for the live tunnel set count. Production code must
 * not depend on this. The set itself stays module-private so callers can't
 * accidentally bypass `register`/`unregister`.
 */
export function _liveTunnelCountForTest(): number {
  return liveTunnels.size;
}
