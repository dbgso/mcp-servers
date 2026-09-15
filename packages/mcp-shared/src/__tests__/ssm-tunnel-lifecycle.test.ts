/**
 * Creating and closing an SSM tunnel.
 *
 * `createSsmTunnel` and `withSsmTunnel` were untested -- the reason functions
 * coverage in this package sat at 64% for the file. They are testable without
 * AWS because the config takes a `spawnFn`, so the aws CLI can be stood in for
 * while the readiness probe talks to a real socket.
 *
 * What is worth holding is the shutdown: SIGINT first, so the CLI tells AWS to
 * end the session rather than leaving session-manager-plugin orphaned, and
 * SIGKILL only if that does not land.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import * as net from "node:net";

import { createSsmTunnel, withSsmTunnel } from "../utils/ssm-tunnel.js";

/** A stand-in for the aws CLI child process. */
class FakeChild extends EventEmitter {
  readonly stderr = new EventEmitter();
  readonly signals: (string | undefined)[] = [];
  exitCode: number | null = null;
  unref = vi.fn();

  kill(signal?: string): boolean {
    this.signals.push(signal);
    // A real CLI exits on SIGINT; exiting here is what lets `close()` resolve
    // without waiting out the escalation timer.
    setImmediate(() => {
      this.exitCode = 0;
      this.emit("exit", 0, signal ?? null);
    });
    return true;
  }
}

/** A port something is already listening on, so the readiness probe succeeds. */
async function listeningPort(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const config = (extra: Record<string, unknown>) => ({
  target: "i-0123456789abcdef0",
  remoteHost: "db.internal",
  remotePort: 5432,
  ...extra,
});

let cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
  vi.restoreAllMocks();
});

describe("createSsmTunnel", () => {
  it("spawns the aws CLI and resolves once the port answers", async () => {
    const { port, close } = await listeningPort();
    cleanup.push(close);
    const child = new FakeChild();
    const spawnFn = vi.fn(() => child as never);

    const tunnel = await createSsmTunnel(
      config({ localPort: port, spawnFn }) as never
    );

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn.mock.calls[0][0]).toBe("aws");
    expect(tunnel.localPort).toBe(port);
    expect(tunnel.localBindHost).toBe("127.0.0.1");
    expect(tunnel.active).toBe(true);
    // The CLI is not the parent's to keep alive.
    expect(child.unref).toHaveBeenCalled();

    await tunnel.close();
  });

  it("passes the profile and region on to the CLI when given", async () => {
    const { port, close } = await listeningPort();
    cleanup.push(close);
    const child = new FakeChild();
    const spawnFn = vi.fn(() => child as never);

    const tunnel = await createSsmTunnel(
      config({ localPort: port, spawnFn, profile: "staging", region: "ap-northeast-1" }) as never
    );

    const args = (spawnFn.mock.calls[0][1] as string[]).join(" ");
    expect(args).toContain("--profile staging");
    expect(args).toContain("--region ap-northeast-1");

    await tunnel.close();
  });

  it("forwards the CLI's own stderr, which carries its advice", async () => {
    // The CLI prints a useful message when session-manager-plugin is missing,
    // including where to get it. Swallowing it would leave the user with a
    // timeout and no reason for it.
    const { port, close } = await listeningPort();
    cleanup.push(close);
    const child = new FakeChild();
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const tunnel = await createSsmTunnel(
      config({ localPort: port, spawnFn: () => child as never }) as never
    );
    child.stderr.emit("data", Buffer.from("SessionManagerPlugin is not found"));

    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("SessionManagerPlugin is not found")
    );

    await tunnel.close();
  });

  it("kills the CLI and reports the failure when the port never answers", async () => {
    // Nothing is listening, so the probe times out. Leaving the child running
    // would strand an aws process for every failed attempt.
    const child = new FakeChild();

    await expect(
      createSsmTunnel(
        config({
          localPort: 1,
          spawnFn: () => child as never,
          readyTimeoutMs: 100,
          probeIntervalMs: 10,
        }) as never
      )
    ).rejects.toThrow();

    expect(child.signals.length).toBeGreaterThan(0);
  });
});

describe("when the caller names no local port", () => {
  it("finds a free one and tells the CLI to use it", async () => {
    // The usual way this is called: the caller wants a tunnel, not a
    // particular port. The port has to reach the CLI arguments, or the
    // readiness probe would be watching a port nothing was asked to bind.
    const child = new FakeChild();
    let bound: net.Server | undefined;

    const tunnel = await createSsmTunnel(
      config({
        spawnFn: (_cmd: string, args: string[]) => {
          // Stand in for the CLI: bind the port it was told to.
          const portArg = args.join(" ").match(/"?localPortNumber"?\s*=?\s*\[?"?(\d+)/);
          const port = Number(portArg?.[1] ?? 0);
          bound = net.createServer();
          bound.listen(port, "127.0.0.1");
          return child as never;
        },
        readyTimeoutMs: 2000,
        probeIntervalMs: 20,
      }) as never
    );

    expect(tunnel.localPort).toBeGreaterThan(0);
    expect(tunnel.active).toBe(true);

    await tunnel.close();
    await new Promise<void>((resolve) => bound?.close(() => resolve()) ?? resolve());
  });

  it("passes a document name through when given one", async () => {
    const { port, close } = await listeningPort();
    cleanup.push(close);
    const child = new FakeChild();
    const spawnFn = vi.fn(() => child as never);

    const tunnel = await createSsmTunnel(
      config({ localPort: port, spawnFn, documentName: "AWS-StartPortForwardingSessionToRemoteHost" }) as never
    );

    expect((spawnFn.mock.calls[0][1] as string[]).join(" ")).toContain(
      "AWS-StartPortForwardingSessionToRemoteHost"
    );

    await tunnel.close();
  });
});

describe("close", () => {
  it("asks for SIGINT first, so AWS is told the session ended", async () => {
    const { port, close } = await listeningPort();
    cleanup.push(close);
    const child = new FakeChild();

    const tunnel = await createSsmTunnel(
      config({ localPort: port, spawnFn: () => child as never }) as never
    );
    await tunnel.close();

    expect(child.signals).toContain("SIGINT");
    expect(child.signals).not.toContain("SIGKILL");
    expect(tunnel.active).toBe(false);
  });

  it("does nothing the second time", async () => {
    const { port, close } = await listeningPort();
    cleanup.push(close);
    const child = new FakeChild();

    const tunnel = await createSsmTunnel(
      config({ localPort: port, spawnFn: () => child as never }) as never
    );
    await tunnel.close();
    const after = child.signals.length;
    await tunnel.close();

    expect(child.signals).toHaveLength(after);
  });

  it("returns immediately when the CLI has already exited", async () => {
    const { port, close } = await listeningPort();
    cleanup.push(close);
    const child = new FakeChild();

    const tunnel = await createSsmTunnel(
      config({ localPort: port, spawnFn: () => child as never }) as never
    );
    // The CLI died on its own; `active` follows the exit.
    child.exitCode = 1;
    child.emit("exit", 1, null);
    await new Promise((r) => setImmediate(r));

    expect(tunnel.active).toBe(false);
    await expect(tunnel.close()).resolves.toBeUndefined();
  });
});

describe("withSsmTunnel", () => {
  it("closes the tunnel after the work", async () => {
    const { port, close } = await listeningPort();
    cleanup.push(close);
    const child = new FakeChild();

    const result = await withSsmTunnel({
      config: config({ localPort: port, spawnFn: () => child as never }) as never,
      fn: async (tunnel) => {
        expect(tunnel.active).toBe(true);
        return "done";
      },
    });

    expect(result).toBe("done");
    expect(child.signals).toContain("SIGINT");
  });

  it("closes it even when the work throws, and lets the error through", async () => {
    // A tunnel left open outlives the process that needed it and keeps an AWS
    // session alive.
    const { port, close } = await listeningPort();
    cleanup.push(close);
    const child = new FakeChild();

    await expect(
      withSsmTunnel({
        config: config({ localPort: port, spawnFn: () => child as never }) as never,
        fn: async () => {
          throw new Error("the query failed");
        },
      })
    ).rejects.toThrow("the query failed");

    expect(child.signals).toContain("SIGINT");
  });
});
