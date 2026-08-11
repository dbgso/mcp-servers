#!/usr/bin/env node
/**
 * Fake `ssh` for integration tests.
 *
 * Parses the same CLI shape as a real `ssh -L` invocation and stands up a
 * local TCP listener that proxies every connection to the remote endpoint.
 *
 * Recognized args:
 *   -L LOCAL_HOST:LOCAL_PORT:REMOTE_HOST:REMOTE_PORT
 *   -i, -N, -T, -o (consumed but ignored)
 *
 * Behavior controlled by env:
 *   FAKE_SSH_FAIL_IMMEDIATELY=1  → exit 255 immediately (simulates bad creds)
 *   FAKE_SSH_DELAY_MS=NNN        → wait NN ms before opening the listener
 *   FAKE_SSH_BIND_FAILS=1        → exit when the listener fails to bind
 */
import net from "node:net";

if (process.env.FAKE_SSH_FAIL_IMMEDIATELY === "1") {
  process.stderr.write("fake-ssh: simulated auth failure\n");
  process.exit(255);
}

const args = process.argv.slice(2);
let forwardSpec = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "-L") {
    forwardSpec = args[i + 1];
    i++;
    continue;
  }
  if (a === "-i" || a === "-o") {
    // consume the value
    i++;
    continue;
  }
  // -N, -T, etc. are flag-only and just ignored
}

if (!forwardSpec) {
  process.stderr.write("fake-ssh: -L spec missing\n");
  process.exit(2);
}

const parts = forwardSpec.split(":");
if (parts.length !== 4) {
  process.stderr.write(`fake-ssh: malformed -L spec: ${forwardSpec}\n`);
  process.exit(2);
}
const [localHost, localPortRaw, remoteHost, remotePortRaw] = parts;
const localPort = Number(localPortRaw);
const remotePort = Number(remotePortRaw);

const delayMs = Number(process.env.FAKE_SSH_DELAY_MS ?? 0);

const start = () => {
  const server = net.createServer((clientSocket) => {
    const upstream = net.createConnection({ host: remoteHost, port: remotePort });
    clientSocket.on("error", () => upstream.destroy());
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.pipe(upstream).pipe(clientSocket);
  });

  server.on("error", (err) => {
    process.stderr.write(`fake-ssh: listen error: ${err.message}\n`);
    if (process.env.FAKE_SSH_BIND_FAILS === "1") process.exit(1);
  });

  server.listen(localPort, localHost, () => {
    process.stderr.write(
      `fake-ssh: forwarding ${localHost}:${localPort} -> ${remoteHost}:${remotePort}\n`,
    );
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

if (delayMs > 0) {
  setTimeout(start, delayMs);
} else {
  start();
}
