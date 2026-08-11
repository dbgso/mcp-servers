import { describe, it, expect, vi } from "vitest";
import { createServer, type Server } from "node:net";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import path from "node:path";
import {
  buildSshArgs,
  expandHome,
  isLoopbackHost,
  findFreePort,
  isPortAcceptingConnections,
  resolveTunneledUrl,
  bastionConfigFromEnv,
  bastionTunnelOpener,
  ssmTunnelOpener,
  pickTunnelOpener,
  createSshTunnel,
  type TunnelOpenerOpts,
} from "../utils/ssh-tunnel.js";

describe("expandHome", () => {
  it.each([
    { desc: "expands ~/", input: "~/foo/bar", expected: path.join(homedir(), "foo/bar") },
    { desc: "expands bare ~", input: "~", expected: homedir() },
    { desc: "leaves absolute paths untouched", input: "/tmp/x", expected: "/tmp/x" },
    { desc: "leaves paths with embedded ~ untouched", input: "/foo/~/bar", expected: "/foo/~/bar" },
  ])("$desc", ({ input, expected }) => {
    expect(expandHome(input)).toBe(expected);
  });
});

describe("buildSshArgs", () => {
  it("includes -i when identityFile is provided (with home expansion)", () => {
    const args = buildSshArgs({
      bastionHost: "ec2-user@host",
      identityFile: "~/key.pem",
      localBindHost: "127.0.0.1",
      localPort: 5433,
      remoteHost: "rds.example.com",
      remotePort: 5432,
    });
    expect(args[0]).toBe("-i");
    expect(args[1]).toBe(path.join(homedir(), "key.pem"));
  });

  it("omits -i when identityFile is missing", () => {
    const args = buildSshArgs({
      bastionHost: "host",
      localBindHost: "127.0.0.1",
      localPort: 5433,
      remoteHost: "rds.example.com",
      remotePort: 5432,
    });
    expect(args).not.toContain("-i");
  });

  it("emits a -L spec with the right host:port mapping", () => {
    const args = buildSshArgs({
      bastionHost: "ec2-user@host",
      localBindHost: "0.0.0.0",
      localPort: 15443,
      remoteHost: "rds.example.com",
      remotePort: 5432,
    });
    const lIdx = args.indexOf("-L");
    expect(args[lIdx + 1]).toBe("0.0.0.0:15443:rds.example.com:5432");
  });

  it("appends extraSshArgs before bastion host", () => {
    const args = buildSshArgs({
      bastionHost: "host",
      localBindHost: "127.0.0.1",
      localPort: 5433,
      remoteHost: "remote",
      remotePort: 5432,
      extraSshArgs: ["-o", "ServerAliveInterval=60"],
    });
    expect(args).toContain("-o");
    expect(args).toContain("ServerAliveInterval=60");
    expect(args[args.length - 1]).toBe("host");
  });

  it("ends with the bastion host", () => {
    const args = buildSshArgs({
      bastionHost: "ec2-user@bastion.example",
      localBindHost: "127.0.0.1",
      localPort: 5433,
      remoteHost: "remote",
      remotePort: 5432,
    });
    expect(args[args.length - 1]).toBe("ec2-user@bastion.example");
  });

  it.each([
    { bind: "127.0.0.1", expectG: false },
    { bind: "localhost", expectG: false },
    { bind: "::1", expectG: false },
    { bind: "0.0.0.0", expectG: true },
    { bind: "*", expectG: true },
    { bind: "192.168.1.10", expectG: true },
  ])("emits -g iff localBindHost is non-loopback ($bind → -g: $expectG)", ({ bind, expectG }) => {
    const args = buildSshArgs({
      bastionHost: "host",
      localBindHost: bind,
      localPort: 5433,
      remoteHost: "remote",
      remotePort: 5432,
    });
    expect(args.includes("-g")).toBe(expectG);
  });
});

describe("isLoopbackHost", () => {
  it.each([
    { host: "127.0.0.1", expected: true },
    { host: "localhost", expected: true },
    { host: "::1", expected: true },
    { host: "0.0.0.0", expected: false },
    { host: "*", expected: false },
    { host: "", expected: false },
    { host: "192.168.1.10", expected: false },
  ])("$host → $expected", ({ host, expected }) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});

describe("findFreePort", () => {
  it("returns a usable port that nothing is bound to", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });
});

describe("isPortAcceptingConnections", () => {
  it("returns true when something is listening", async () => {
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      const ok = await isPortAcceptingConnections({ host: "127.0.0.1", port });
      expect(ok).toBe(true);
    } finally {
      server.close();
    }
  });

  it("returns false when nothing is listening", async () => {
    const port = await findFreePort();
    const ok = await isPortAcceptingConnections({ host: "127.0.0.1", port, timeoutMs: 200 });
    expect(ok).toBe(false);
  });
});

describe("resolveTunneledUrl", () => {
  it("returns the URL unchanged when no tunnel spec is provided", async () => {
    const result = await resolveTunneledUrl({
      url: "postgres://user:pass@db:5432/mydb",
    });
    expect(result.url).toBe("postgres://user:pass@db:5432/mydb");
    expect(result.tunnel).toBeUndefined();
  });

  it("throws when the URL is missing an explicit port and a bastion tunnel is requested", async () => {
    await expect(
      resolveTunneledUrl({
        url: "postgres://user:pass@db/mydb",
        tunnel: { bastion: { host: "ec2-user@bastion" } },
      }),
    ).rejects.toThrow(/explicit port/);
  });

  it("throws when the URL is missing an explicit port and an SSM tunnel is requested", async () => {
    await expect(
      resolveTunneledUrl({
        url: "postgres://user:pass@db/mydb",
        tunnel: { ssm: { target: "i-012345" } },
      }),
    ).rejects.toThrow(/explicit port/);
  });
});

describe("tunnel opener strategy (pickTunnelOpener / *TunnelOpener)", () => {
  // Each opener captures the kind-specific config in a closure, so the
  // resulting argv to the actual `aws` / `ssh` spawn is the lock-test
  // surface. Stash the spawn args via a fake spawnFn and assert.

  const commonOpts: TunnelOpenerOpts = {
    localBindHost: "127.0.0.1",
    localPort: 65000, // dummy — fake spawn never binds
    remoteHost: "db.example",
    remotePort: 5432,
    readyTimeoutMs: 100, // short — fake spawn never makes the port ready
    spawnFn: undefined, // overridden per test
  };

  function makeFakeSpawn(): {
    spawnFn: NonNullable<TunnelOpenerOpts["spawnFn"]>;
    args: { cmd: string; argv: readonly string[] }[];
  } {
    const args: { cmd: string; argv: readonly string[] }[] = [];
    return {
      spawnFn: ((cmd: string, argv: readonly string[]) => {
        args.push({ cmd, argv });
        // Return a never-ready child that immediately exits so the opener's
        // waitForPort eventually times out (acceptable — we only assert on
        // argv, not the rejection itself).
        const child = new EventEmitter() as EventEmitter & {
          stderr: null;
          exitCode: number | null;
          unref: () => void;
          kill: () => boolean;
        };
        child.stderr = null;
        child.exitCode = null;
        child.unref = (): void => undefined;
        child.kill = (): boolean => true;
        // Schedule a self-exit so waitForPort breaks out of its loop.
        setImmediate(() => {
          child.exitCode = 1;
          child.emit("exit");
        });
        return child as unknown as Awaited<ReturnType<typeof createSshTunnel>>;
      }) as unknown as NonNullable<TunnelOpenerOpts["spawnFn"]>,
      args,
    };
  }

  it("pickTunnelOpener routes 'bastion' kind to bastionTunnelOpener", async () => {
    const { spawnFn, args } = makeFakeSpawn();
    const opener = pickTunnelOpener({
      bastion: { host: "ec2-user@bastion", identityFile: "/k.pem" },
    });
    await expect(opener({ ...commonOpts, spawnFn })).rejects.toThrow();
    // ssh opener spawns `ssh`, not `aws`.
    expect(args[0]?.cmd).toBe("ssh");
    expect(args[0]?.argv).toContain("ec2-user@bastion");
    expect(args[0]?.argv.some((a) => a.endsWith("/k.pem"))).toBe(true);
  });

  it("pickTunnelOpener routes 'ssm' kind to ssmTunnelOpener", async () => {
    const { spawnFn, args } = makeFakeSpawn();
    const opener = pickTunnelOpener({ ssm: { target: "i-0001" } });
    await expect(opener({ ...commonOpts, spawnFn })).rejects.toThrow();
    expect(args[0]?.cmd).toBe("aws");
    expect(args[0]?.argv).toContain("ssm");
    expect(args[0]?.argv).toContain("start-session");
    expect(args[0]?.argv).toContain("i-0001");
  });

  it("bastionTunnelOpener forwards extraSshArgs through to ssh argv", async () => {
    const { spawnFn, args } = makeFakeSpawn();
    const opener = bastionTunnelOpener({
      host: "ec2-user@b",
      extraSshArgs: ["-o", "ServerAliveInterval=60"],
    });
    await expect(opener({ ...commonOpts, spawnFn })).rejects.toThrow();
    expect(args[0]?.argv).toContain("ServerAliveInterval=60");
  });

  it("bastionTunnelOpener omits -i when identityFile is unset", async () => {
    const { spawnFn, args } = makeFakeSpawn();
    const opener = bastionTunnelOpener({ host: "ec2-user@b" });
    await expect(opener({ ...commonOpts, spawnFn })).rejects.toThrow();
    expect(args[0]?.argv).not.toContain("-i");
  });

  it("ssmTunnelOpener forwards profile / region / documentName as flags", async () => {
    const { spawnFn, args } = makeFakeSpawn();
    const opener = ssmTunnelOpener({
      target: "i-x",
      profile: "p",
      region: "r",
      documentName: "AWS-StartPortForwardingSession",
    });
    await expect(opener({ ...commonOpts, spawnFn })).rejects.toThrow();
    const argv = args[0]?.argv ?? [];
    expect(argv).toContain("--profile");
    expect(argv).toContain("p");
    expect(argv).toContain("--region");
    expect(argv).toContain("r");
    const docIdx = argv.indexOf("--document-name");
    expect(argv[docIdx + 1]).toBe("AWS-StartPortForwardingSession");
  });

  it("ssmTunnelOpener stitches host:port into the --parameters argument", async () => {
    const { spawnFn, args } = makeFakeSpawn();
    const opener = ssmTunnelOpener({ target: "i-x" });
    await expect(
      opener({ ...commonOpts, remoteHost: "rds.private", remotePort: 3306, spawnFn }),
    ).rejects.toThrow();
    const argv = args[0]?.argv ?? [];
    expect(argv).toContain(
      `host=rds.private,portNumber=3306,localPortNumber=${commonOpts.localPort}`,
    );
  });
});

describe("bastionConfigFromEnv", () => {
  it("returns null when no bastion host is set", () => {
    const old = process.env.MISSING_BASTION_HOST;
    delete process.env.MISSING_BASTION_HOST;
    try {
      expect(bastionConfigFromEnv("MISSING")).toBeNull();
    } finally {
      if (old) process.env.MISSING_BASTION_HOST = old;
    }
  });

  it("returns host-only config when key/extra args are absent", () => {
    delete process.env.MINPFX_BASTION_KEY;
    delete process.env.MINPFX_BASTION_EXTRA_ARGS;
    process.env.MINPFX_BASTION_HOST = "ec2-user@bastion";
    try {
      const cfg = bastionConfigFromEnv("MINPFX");
      expect(cfg).toEqual({ host: "ec2-user@bastion" });
      expect(cfg?.identityFile).toBeUndefined();
      expect(cfg?.extraSshArgs).toBeUndefined();
    } finally {
      delete process.env.MINPFX_BASTION_HOST;
    }
  });

  it("reads host + key + extra args from env", () => {
    process.env.TESTPFX_BASTION_HOST = "ec2-user@bastion";
    process.env.TESTPFX_BASTION_KEY = "~/.ssh/key.pem";
    process.env.TESTPFX_BASTION_EXTRA_ARGS = "-o ServerAliveInterval=60";
    try {
      const cfg = bastionConfigFromEnv("TESTPFX");
      expect(cfg).toEqual({
        host: "ec2-user@bastion",
        identityFile: "~/.ssh/key.pem",
        extraSshArgs: ["-o", "ServerAliveInterval=60"],
      });
    } finally {
      delete process.env.TESTPFX_BASTION_HOST;
      delete process.env.TESTPFX_BASTION_KEY;
      delete process.env.TESTPFX_BASTION_EXTRA_ARGS;
    }
  });
});

/**
 * Build a fake child process that we can drive from tests. Doesn't actually
 * spawn ssh — we open a plain TCP listener on the requested local port to
 * simulate a working tunnel.
 */
function makeFakeSshChild(localPort: number): {
  child: EventEmitter & { stderr: EventEmitter; kill: () => void; unref: () => void; exitCode: number | null };
  server: Server;
} {
  const child = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    exitCode: null as number | null,
    kill: () => {
      // Simulate process death: stop listening, mark exited.
      server.close();
      child.exitCode = 0;
      child.emit("exit", 0, null);
    },
    unref: () => undefined,
  });
  const server = createServer();
  server.listen(localPort, "127.0.0.1");
  return { child, server };
}

describe("createSshTunnel (with mocked spawn)", () => {
  it("opens a tunnel, exposes localPort, and closes cleanly", async () => {
    const port = await findFreePort();
    const fake = makeFakeSshChild(port);
    const spawnFn = vi.fn().mockReturnValue(fake.child);

    const tunnel = await createSshTunnel({
      bastionHost: "ec2-user@bastion",
      remoteHost: "db.example.com",
      remotePort: 5432,
      localPort: port,
      readyTimeoutMs: 2_000,
      spawnFn: spawnFn as never,
    });

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn.mock.calls[0][0]).toBe("ssh");
    expect(tunnel.localPort).toBe(port);
    expect(tunnel.localBindHost).toBe("127.0.0.1");
    expect(tunnel.active).toBe(true);

    await tunnel.close();
    expect(tunnel.active).toBe(false);

    // Idempotent
    await tunnel.close();
  });

  it("rejects when ssh exits before the port is ready", async () => {
    const port = await findFreePort();
    const child = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      exitCode: null as number | null,
      kill: () => undefined,
      unref: () => undefined,
    });

    // Simulate immediate exit on next tick.
    setImmediate(() => {
      child.exitCode = 255;
      child.emit("exit", 255, null);
    });

    await expect(
      createSshTunnel({
        bastionHost: "ec2-user@bastion",
        remoteHost: "db.example.com",
        remotePort: 5432,
        localPort: port,
        readyTimeoutMs: 1_000,
        probeIntervalMs: 50,
        spawnFn: (() => child) as never,
      }),
    ).rejects.toThrow(/ssh exited/);
  });
});
