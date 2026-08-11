/**
 * Integration tests for the SSH tunnel helpers.
 *
 * Real `ssh` is replaced by `fake-ssh.mjs` (a Node script that mirrors the
 * CLI shape and stands up a TCP proxy). Everything else — child process
 * spawning, port readiness probing, lifecycle, signal handling — runs for
 * real, so these tests cover the full integration path that unit tests
 * cannot exercise.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server, Socket } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  createSshTunnel,
  withSshTunnel,
  resolveTunneledUrl,
  findFreePort,
  type SshTunnelConfig,
} from "../utils/ssh-tunnel.js";

const fakeSshPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fake-ssh.mjs",
);

/** Spawn that swaps `ssh` for our fake-ssh node script with the same args. */
function fakeSshSpawn(envOverrides: Record<string, string> = {}) {
  return (_cmd: string, args: readonly string[]) =>
    spawn("node", [fakeSshPath, ...args], {
      env: { ...process.env, ...envOverrides },
      stdio: ["ignore", "ignore", "pipe"],
    });
}

/** Tiny TCP echo server, used as the "remote" the tunnel forwards to. */
class EchoServer {
  readonly server: Server;
  readonly connections = new Set<Socket>();
  port = 0;

  constructor() {
    this.server = createServer((socket) => {
      this.connections.add(socket);
      socket.on("close", () => this.connections.delete(socket));
      socket.on("data", (chunk) => socket.write(chunk));
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const addr = this.server.address();
    this.port = typeof addr === "object" && addr ? addr.port : 0;
  }

  async stop(): Promise<void> {
    for (const s of this.connections) s.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/** Connect to host:port and exchange a single line, returning the echo. */
function echoRoundTrip(params: {
  host: string;
  port: number;
  payload: string;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = new Socket();
    let received = "";
    sock.setTimeout(2000);
    sock.on("data", (b) => {
      received += b.toString("utf-8");
      sock.end();
    });
    sock.on("end", () => resolve(received));
    sock.on("error", reject);
    sock.on("timeout", () => {
      sock.destroy();
      reject(new Error("echoRoundTrip timeout"));
    });
    sock.connect(params.port, params.host, () => sock.write(params.payload));
  });
}

const baseConfig = (overrides: Partial<SshTunnelConfig> = {}): SshTunnelConfig => ({
  bastionHost: "ec2-user@bastion.example",
  remoteHost: "127.0.0.1",
  remotePort: 0, // filled in per test
  readyTimeoutMs: 5_000,
  probeIntervalMs: 100,
  spawnFn: fakeSshSpawn(),
  ...overrides,
});

describe("ssh-tunnel integration", () => {
  let echo: EchoServer;

  beforeAll(async () => {
    echo = new EchoServer();
    await echo.start();
  });

  afterAll(async () => {
    await echo.stop();
  });

  it("forwards real TCP traffic from local port through the tunnel to the remote", async () => {
    const tunnel = await createSshTunnel(
      baseConfig({ remotePort: echo.port }),
    );
    try {
      const echoed = await echoRoundTrip({
        host: "127.0.0.1",
        port: tunnel.localPort,
        payload: "hello-tunnel",
      });
      expect(echoed).toBe("hello-tunnel");
    } finally {
      await tunnel.close();
    }
  });

  it("auto-allocates a local port when none is provided", async () => {
    const tunnel = await createSshTunnel(
      baseConfig({ remotePort: echo.port }),
    );
    try {
      expect(tunnel.localPort).toBeGreaterThan(0);
      // Independent connection works on the auto-assigned port.
      const echoed = await echoRoundTrip({
        host: "127.0.0.1",
        port: tunnel.localPort,
        payload: "auto-port",
      });
      expect(echoed).toBe("auto-port");
    } finally {
      await tunnel.close();
    }
  });

  it("close() kills the child process and frees the local port", async () => {
    const localPort = await findFreePort();
    const tunnel = await createSshTunnel(
      baseConfig({ remotePort: echo.port, localPort }),
    );
    expect(tunnel.active).toBe(true);

    await tunnel.close();
    expect(tunnel.active).toBe(false);

    // Reusing the port immediately should succeed (i.e. the child released it).
    const second = await createSshTunnel(
      baseConfig({ remotePort: echo.port, localPort }),
    );
    try {
      const echoed = await echoRoundTrip({
        host: "127.0.0.1",
        port: second.localPort,
        payload: "reused",
      });
      expect(echoed).toBe("reused");
    } finally {
      await second.close();
    }
  });

  it("close() is idempotent", async () => {
    const tunnel = await createSshTunnel(
      baseConfig({ remotePort: echo.port }),
    );
    await tunnel.close();
    await tunnel.close();
    expect(tunnel.active).toBe(false);
  });

  it("supports two concurrent tunnels with different local ports", async () => {
    const a = await createSshTunnel(baseConfig({ remotePort: echo.port }));
    const b = await createSshTunnel(baseConfig({ remotePort: echo.port }));
    try {
      expect(a.localPort).not.toBe(b.localPort);
      const [r1, r2] = await Promise.all([
        echoRoundTrip({ host: "127.0.0.1", port: a.localPort, payload: "A" }),
        echoRoundTrip({ host: "127.0.0.1", port: b.localPort, payload: "B" }),
      ]);
      expect(r1).toBe("A");
      expect(r2).toBe("B");
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });

  it("rejects when the ssh process exits before the tunnel becomes ready", async () => {
    await expect(
      createSshTunnel(
        baseConfig({
          remotePort: echo.port,
          readyTimeoutMs: 2_000,
          probeIntervalMs: 100,
          spawnFn: fakeSshSpawn({ FAKE_SSH_FAIL_IMMEDIATELY: "1" }),
        }),
      ),
    ).rejects.toThrow(/ssh exited/);
  });

  it("times out and tears down the child if the tunnel never opens", async () => {
    const trackedSpawned: ChildProcess[] = [];
    const baseSpawn = fakeSshSpawn({ FAKE_SSH_DELAY_MS: "5000" });
    const trackingSpawn: SshTunnelConfig["spawnFn"] = (cmd, args) => {
      const child = baseSpawn(cmd, args);
      trackedSpawned.push(child);
      return child;
    };

    await expect(
      createSshTunnel(
        baseConfig({
          remotePort: echo.port,
          readyTimeoutMs: 500, // shorter than fake-ssh's 5s delay
          probeIntervalMs: 100,
          spawnFn: trackingSpawn,
        }),
      ),
    ).rejects.toThrow(/Timeout/);

    // The spawned child must have been killed as part of the failure path.
    for (const child of trackedSpawned) {
      // exitCode may be null for an in-flight kill; wait briefly.
      if (child.exitCode === null) {
        await new Promise<void>((r) => child.once("exit", () => r()));
      }
      expect(child.exitCode === null && child.signalCode === null).toBe(false);
    }
  });
});

describe("withSshTunnel integration", () => {
  let echo: EchoServer;

  beforeAll(async () => {
    echo = new EchoServer();
    await echo.start();
  });

  afterAll(async () => {
    await echo.stop();
  });

  it("closes the tunnel after the callback resolves", async () => {
    let portInsideCallback = 0;
    const value = await withSshTunnel({
      config: baseConfig({ remotePort: echo.port }),
      fn: async (tunnel) => {
        portInsideCallback = tunnel.localPort;
        const echoed = await echoRoundTrip({
          host: "127.0.0.1",
          port: tunnel.localPort,
          payload: "scope",
        });
        return echoed;
      },
    });
    expect(value).toBe("scope");
    // After return, the port should no longer accept connections.
    await expect(
      echoRoundTrip({ host: "127.0.0.1", port: portInsideCallback, payload: "after" }),
    ).rejects.toBeTruthy();
  });

  it("closes the tunnel even when the callback throws", async () => {
    let portInsideCallback = 0;
    await expect(
      withSshTunnel({
        config: baseConfig({ remotePort: echo.port }),
        fn: async (tunnel) => {
          portInsideCallback = tunnel.localPort;
          throw new Error("user error");
        },
      }),
    ).rejects.toThrow("user error");

    await expect(
      echoRoundTrip({ host: "127.0.0.1", port: portInsideCallback, payload: "after-throw" }),
    ).rejects.toBeTruthy();
  });
});

describe("process exit / signal handlers", () => {
  let echo: EchoServer;

  beforeAll(async () => {
    echo = new EchoServer();
    await echo.start();
  });

  afterAll(async () => {
    await echo.stop();
  });

  /**
   * Pull the latest listener registered on a given process event.
   * Used to invoke our cleanup hooks directly without actually exiting.
   */
  function lastListener(event: "exit" | "SIGINT" | "SIGTERM"): (() => void) | undefined {
    const listeners = process.listeners(event);
    return listeners[listeners.length - 1] as (() => void) | undefined;
  }

  it("kills live tunnels via the process 'exit' handler", async () => {
    const tunnel = await createSshTunnel(baseConfig({ remotePort: echo.port }));
    try {
      const exitListener = lastListener("exit");
      expect(exitListener).toBeDefined();
      // Invoking the exit listener should kill the live tunnel synchronously.
      exitListener!();
      // Wait briefly for the child to actually exit.
      const deadline = Date.now() + 1500;
      while (tunnel.active && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(tunnel.active).toBe(false);
    } finally {
      await tunnel.close();
    }
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "kills live tunnels and exits on %s",
    async (signal) => {
      const tunnel = await createSshTunnel(baseConfig({ remotePort: echo.port }));
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(((_code?: number) => undefined) as never);
      try {
        const sigListener = lastListener(signal);
        expect(sigListener).toBeDefined();
        sigListener!();
        expect(exitSpy).toHaveBeenCalledWith(signal === "SIGINT" ? 130 : 143);
        const deadline = Date.now() + 1500;
        while (tunnel.active && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
        }
        expect(tunnel.active).toBe(false);
      } finally {
        exitSpy.mockRestore();
        await tunnel.close();
      }
    },
  );
});

describe("resolveTunneledUrl integration", () => {
  let echo: EchoServer;
  const openTunnels: Array<{ close: () => Promise<void> }> = [];

  beforeAll(async () => {
    echo = new EchoServer();
    await echo.start();
  });

  afterAll(async () => {
    await echo.stop();
  });

  beforeEach(() => {
    openTunnels.length = 0;
  });

  afterEach(async () => {
    await Promise.all(openTunnels.map((t) => t.close()));
  });

  it("rewrites the URL host:port to the tunnel and the new URL points at a working tunnel", async () => {
    const remoteUrl = `tcp://user:pass@127.0.0.1:${echo.port}/somepath?x=1`;
    const { url, tunnel } = await resolveTunneledUrl({
      url: remoteUrl,
      tunnel: { bastion: { host: "ec2-user@bastion.example" } },
      readyTimeoutMs: 5_000,
      spawnFn: fakeSshSpawn(),
    });
    expect(tunnel).toBeDefined();
    openTunnels.push(tunnel!);

    const parsed = new URL(url);
    expect(parsed.hostname).toBe("127.0.0.1");
    expect(parsed.port).toBe(String(tunnel!.localPort));
    // userinfo / path / query are preserved
    expect(parsed.username).toBe("user");
    expect(parsed.password).toBe("pass");
    expect(parsed.pathname).toBe("/somepath");
    expect(parsed.search).toBe("?x=1");

    // Connect to the rewritten URL's host:port; it must reach the echo server.
    const echoed = await echoRoundTrip({
      host: parsed.hostname,
      port: Number(parsed.port),
      payload: "url-rewrite",
    });
    expect(echoed).toBe("url-rewrite");
  });

  it("returns the URL unchanged when no tunnel spec is supplied", async () => {
    const original = `postgres://u:p@db.example:5432/mydb`;
    const { url, tunnel } = await resolveTunneledUrl({ url: original });
    expect(url).toBe(original);
    expect(tunnel).toBeUndefined();
  });

  it("forwards identityFile and extraSshArgs to the spawned ssh", async () => {
    const captured: { args: readonly string[] }[] = [];
    const baseSpawn = fakeSshSpawn();
    const capturingSpawn: SshTunnelConfig["spawnFn"] = (cmd, args) => {
      captured.push({ args });
      return baseSpawn(cmd, args);
    };

    const { url, tunnel } = await resolveTunneledUrl({
      url: `tcp://user:pass@127.0.0.1:${echo.port}/db`,
      tunnel: {
        bastion: {
          host: "ec2-user@bastion.example",
          identityFile: "~/.ssh/test.pem",
          extraSshArgs: ["-o", "ServerAliveInterval=60"],
        },
      },
      readyTimeoutMs: 5_000,
      spawnFn: capturingSpawn,
    });
    expect(tunnel).toBeDefined();
    openTunnels.push(tunnel!);

    expect(captured).toHaveLength(1);
    const args = captured[0].args;
    // -i with expanded identityFile
    const iIdx = args.indexOf("-i");
    expect(iIdx).toBeGreaterThanOrEqual(0);
    expect(args[iIdx + 1]).toMatch(/\.ssh\/test\.pem$/);
    // extraSshArgs were appended
    expect(args).toContain("ServerAliveInterval=60");

    // Sanity: the rewritten URL still works.
    const parsed = new URL(url);
    const echoed = await echoRoundTrip({
      host: parsed.hostname,
      port: Number(parsed.port),
      payload: "with-identity",
    });
    expect(echoed).toBe("with-identity");
  });
});
