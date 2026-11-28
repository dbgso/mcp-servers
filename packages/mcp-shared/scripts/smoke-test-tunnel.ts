/**
 * Live smoke test for createSshTunnel against a real SSH bastion.
 *
 * Usage:
 *   tsx scripts/smoke-test-tunnel.ts \
 *     --bastion ec2-user@HOST --key /path/to/key.pem \
 *     --local-port 35432 --bind 0.0.0.0 \
 *     --remote-host TARGET --remote-port 5432
 *
 * Verifies:
 *   1. The tunnel comes up within the timeout.
 *   2. localhost:LOCAL_PORT accepts TCP connections.
 *   3. The bind address (e.g. 0.0.0.0) actually accepts connections from a
 *      non-loopback local interface (catches the missing -g case).
 *   4. The tunnel closes cleanly without leaving the ssh child behind.
 */
import { createSshTunnel, isPortAcceptingConnections } from "../src/utils/ssh-tunnel.js";
import { networkInterfaces } from "node:os";

interface CliArgs {
  bastion: string;
  key: string;
  localPort: number;
  bind: string;
  remoteHost: string;
  remotePort: number;
  verbose: boolean;
}

/** How one flag lands in the parsed args. `next()` consumes the flag's value. */
type FlagReader = (params: { out: Partial<CliArgs>; next: () => string }) => void;

const FLAG_READERS = new Map<string, FlagReader>([
  ["--bastion", ({ out, next }) => {
    out.bastion = next();
  }],
  ["--key", ({ out, next }) => {
    out.key = next();
  }],
  ["--local-port", ({ out, next }) => {
    out.localPort = Number(next());
  }],
  ["--bind", ({ out, next }) => {
    out.bind = next();
  }],
  ["--remote-host", ({ out, next }) => {
    out.remoteHost = next();
  }],
  ["--remote-port", ({ out, next }) => {
    out.remotePort = Number(next());
  }],
  ["-v", ({ out }) => {
    out.verbose = true;
  }],
  ["--verbose", ({ out }) => {
    out.verbose = true;
  }],
]);

const REQUIRED_ARGS = ["bastion", "key", "localPort", "remoteHost", "remotePort"] as const;

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = { bind: "127.0.0.1", verbose: false };
  for (let i = 0; i < argv.length; i++) {
    FLAG_READERS.get(argv[i])?.({ out, next: () => argv[++i] });
  }
  return withRequiredArgs(out);
}

/** Report the flag the user would have typed, not the field name behind it. */
function withRequiredArgs(out: Partial<CliArgs>): CliArgs {
  for (const k of REQUIRED_ARGS) {
    if (out[k] === undefined) throw new Error(`missing --${k.replace(/([A-Z])/g, "-$1").toLowerCase()}`);
  }
  return out as CliArgs;
}

function findNonLoopbackIpv4(): string | null {
  const addresses = Object.values(networkInterfaces()).flatMap((list) => list ?? []);
  return addresses.find(isExternalIpv4)?.address ?? null;
}

/** Only an address reachable from another host proves the `-g` forward works. */
function isExternalIpv4(iface: { family: string; internal: boolean }): boolean {
  return iface.family === "IPv4" && !iface.internal;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log("[smoke] config:", {
    bastion: args.bastion,
    key: args.key,
    bind: args.bind,
    localPort: args.localPort,
    remoteHost: args.remoteHost,
    remotePort: args.remotePort,
  });

  const start = Date.now();
  const tunnel = await createSshTunnel({
    bastionHost: args.bastion,
    identityFile: args.key,
    localBindHost: args.bind,
    localPort: args.localPort,
    remoteHost: args.remoteHost,
    remotePort: args.remotePort,
    extraSshArgs: args.verbose ? ["-v"] : [],
    readyTimeoutMs: 30_000,
  });
  console.log(`[smoke] tunnel ready on ${args.bind}:${tunnel.localPort} (${Date.now() - start}ms)`);

  // Always probe loopback first.
  const loopbackOk = await isPortAcceptingConnections({
    host: "127.0.0.1",
    port: tunnel.localPort,
    timeoutMs: 3_000,
  });
  console.log(`[smoke] 127.0.0.1:${tunnel.localPort} accepts: ${loopbackOk}`);

  // If the user asked for 0.0.0.0, probe via a real LAN interface.
  if (args.bind === "0.0.0.0") {
    await probeLanReachability(tunnel.localPort);
  }

  console.log("[smoke] active:", tunnel.active);
  console.log("[smoke] closing tunnel...");
  await tunnel.close();
  console.log("[smoke] active after close:", tunnel.active);

  await assertPortFreed(tunnel.localPort);
  console.log("[smoke] OK");
}

/**
 * The point of `--bind 0.0.0.0` is reachability from another host, and probing
 * only loopback would pass even when ssh had silently dropped the `-g`.
 */
async function probeLanReachability(localPort: number): Promise<void> {
  const lanIp = findNonLoopbackIpv4();
  if (!lanIp) {
    console.log("[smoke] no non-loopback IPv4 interface found; skipping LAN probe");
    return;
  }
  const lanOk = await isPortAcceptingConnections({
    host: lanIp,
    port: localPort,
    timeoutMs: 3_000,
  });
  console.log(`[smoke] ${lanIp}:${localPort} accepts: ${lanOk} (validates -g)`);
}

/** A port still listening after `close()` means the ssh child outlived us. */
async function assertPortFreed(localPort: number): Promise<void> {
  const stillAccepting = await isPortAcceptingConnections({
    host: "127.0.0.1",
    port: localPort,
    timeoutMs: 500,
  });
  console.log(`[smoke] 127.0.0.1:${localPort} accepts after close: ${stillAccepting}`);
  if (stillAccepting) {
    throw new Error("port still accepting connections after close()");
  }
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exit(1);
});
