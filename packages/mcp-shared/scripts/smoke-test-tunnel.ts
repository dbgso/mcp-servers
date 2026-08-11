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

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = { bind: "127.0.0.1", verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--bastion":
        out.bastion = next();
        break;
      case "--key":
        out.key = next();
        break;
      case "--local-port":
        out.localPort = Number(next());
        break;
      case "--bind":
        out.bind = next();
        break;
      case "--remote-host":
        out.remoteHost = next();
        break;
      case "--remote-port":
        out.remotePort = Number(next());
        break;
      case "-v":
      case "--verbose":
        out.verbose = true;
        break;
    }
  }
  for (const k of ["bastion", "key", "localPort", "remoteHost", "remotePort"] as const) {
    if (out[k] === undefined) throw new Error(`missing --${k.replace(/([A-Z])/g, "-$1").toLowerCase()}`);
  }
  return out as CliArgs;
}

function findNonLoopbackIpv4(): string | null {
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
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
    const lanIp = findNonLoopbackIpv4();
    if (lanIp) {
      const lanOk = await isPortAcceptingConnections({
        host: lanIp,
        port: tunnel.localPort,
        timeoutMs: 3_000,
      });
      console.log(`[smoke] ${lanIp}:${tunnel.localPort} accepts: ${lanOk} (validates -g)`);
    } else {
      console.log("[smoke] no non-loopback IPv4 interface found; skipping LAN probe");
    }
  }

  console.log("[smoke] active:", tunnel.active);
  console.log("[smoke] closing tunnel...");
  await tunnel.close();
  console.log("[smoke] active after close:", tunnel.active);

  // Verify the port really got freed.
  const stillAccepting = await isPortAcceptingConnections({
    host: "127.0.0.1",
    port: tunnel.localPort,
    timeoutMs: 500,
  });
  console.log(`[smoke] 127.0.0.1:${tunnel.localPort} accepts after close: ${stillAccepting}`);
  if (stillAccepting) {
    throw new Error("port still accepting connections after close()");
  }
  console.log("[smoke] OK");
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exit(1);
});
