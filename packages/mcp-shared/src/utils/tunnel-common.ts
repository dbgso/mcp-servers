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
import { type ChildProcess } from "node:child_process";
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
  const label = params.childLabel ?? "tunnel process";
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() < deadline) {
    if (params.child.exitCode !== null) {
      throw new Error(
        `${label} exited before tunnel was ready (exit code ${params.child.exitCode})`,
      );
    }
    if (
      await isPortAcceptingConnections({ host: params.host, port: params.port })
    ) {
      return;
    }
    await new Promise((r) => setTimeout(r, params.intervalMs));
  }
  throw new Error(
    `Timeout waiting for tunnel on ${params.host}:${params.port} after ${params.timeoutMs}ms`,
  );
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
 * Test-only accessor for the live tunnel set count. Production code must
 * not depend on this. The set itself stays module-private so callers can't
 * accidentally bypass `register`/`unregister`.
 */
export function _liveTunnelCountForTest(): number {
  return liveTunnels.size;
}
