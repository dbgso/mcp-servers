/**
 * Engine-strategy tests.
 *
 * Covers the dispatcher (`pickEngineStrategy`), MySQL-specific helpers
 * (TLS detection + DBREAD_STATEMENT_TIMEOUT → milliseconds parsing), and
 * end-to-end MySQL `open()` behaviour with mysql2 mocked at the dynamic
 * import boundary. PG side is exercised in the existing `server.test.ts`
 * defaultOpenConnection block.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TableMetadataMap } from "mcp-shared-db";
import type { TunnelSpec } from "mcp-shared/tunnel";
import { pickEngineStrategy, ENGINE_STRATEGIES } from "../strategies/pick.js";
import {
  mysqlStrategy,
  parseTimeoutMs,
  DEFAULT_MAX_EXECUTION_TIME_MS,
} from "../strategies/mysql.js";
import { postgresStrategy } from "../strategies/pg.js";

const tableMetadata: TableMetadataMap = {
  users: {
    tableName: "users",
    primaryKey: ["id"],
    fields: { id: { type: "string", nullable: false } },
  },
};

describe("pickEngineStrategy", () => {
  it.each([
    "postgres://u:p@h/db",
    "POSTGRES://u:p@h/db",
    "postgresql://u:p@h/db",
    "postgresql://u:p@h/db?sslmode=require",
  ])("routes '%s' to the postgres strategy", (url) => {
    expect(pickEngineStrategy(url)).toBe(postgresStrategy);
  });

  it.each([
    "mysql://u:p@h/db",
    "MYSQL://u:p@h/db",
    "mysql://u:p@h:3306/db?ssl=true",
  ])("routes '%s' to the mysql strategy", (url) => {
    expect(pickEngineStrategy(url)).toBe(mysqlStrategy);
  });

  it.each([
    "sqlite:///tmp/db.sqlite",
    "mongodb://localhost",
    "redis://h",
    "://no-scheme",
    "totally-bogus",
  ])("rejects unsupported URL '%s' with a helpful message", (url) => {
    expect(() => pickEngineStrategy(url)).toThrow(/Unsupported DB URL scheme/);
  });

  it("redacts credentials in the unsupported-scheme error message", () => {
    expect(() =>
      pickEngineStrategy("redis://app:secret@h:6379/0"),
    ).toThrow(/redis:\/\/h:6379/);
    expect(() =>
      pickEngineStrategy("redis://app:secret@h:6379/0"),
    ).not.toThrow(/secret/);
  });

  it("registers postgres + mysql in ENGINE_STRATEGIES", () => {
    expect(ENGINE_STRATEGIES.map((s) => s.engine)).toEqual([
      "postgres",
      "mysql",
    ]);
  });
});

describe("parseTimeoutMs", () => {
  it.each([
    { input: undefined, expected: DEFAULT_MAX_EXECUTION_TIME_MS },
    { input: "", expected: DEFAULT_MAX_EXECUTION_TIME_MS },
    { input: "   ", expected: DEFAULT_MAX_EXECUTION_TIME_MS },
    { input: "0", expected: 0 },
    { input: "500", expected: 500 },
    { input: "500ms", expected: 500 },
    { input: "10s", expected: 10_000 },
    { input: "1.5s", expected: 1500 },
    { input: "5min", expected: 300_000 },
    { input: "garbage", expected: DEFAULT_MAX_EXECUTION_TIME_MS },
    { input: "10sec", expected: DEFAULT_MAX_EXECUTION_TIME_MS },
  ])("parses '$input' to $expected ms", ({ input, expected }) => {
    expect(parseTimeoutMs(input)).toBe(expected);
  });
});

describe("mysqlStrategy.detectInsecureTls", () => {
  it.each<{
    label: string;
    url: string;
    tunnel: TunnelSpec | null;
    warn: boolean;
  }>([
    {
      label: "no tunnel + no ssl → warn",
      url: "mysql://u:p@h:3306/d",
      tunnel: null,
      warn: true,
    },
    {
      label: "ssl=true → silent",
      url: "mysql://u:p@h/d?ssl=true",
      tunnel: null,
      warn: false,
    },
    {
      label: "ssl-mode=required → silent",
      url: "mysql://u:p@h/d?ssl-mode=required",
      tunnel: null,
      warn: false,
    },
    {
      label: "ssl-mode=verify-identity → silent",
      url: "mysql://u:p@h/d?ssl-mode=verify-identity",
      tunnel: null,
      warn: false,
    },
    {
      label: "sslmode=required (no hyphen) → silent",
      url: "mysql://u:p@h/d?sslmode=required",
      tunnel: null,
      warn: false,
    },
    {
      label: "ssl-mode=disabled → warn",
      url: "mysql://u:p@h/d?ssl-mode=disabled",
      tunnel: null,
      warn: true,
    },
    {
      label: "ssl-mode=preferred → warn (allows plaintext fallback)",
      url: "mysql://u:p@h/d?ssl-mode=preferred",
      tunnel: null,
      warn: true,
    },
    {
      label: "ssh bastion tunnel → silent (tunnel encrypts)",
      url: "mysql://u:p@h/d",
      tunnel: { bastion: { host: "bastion.example", identityFile: "/k.pem" } },
      warn: false,
    },
    {
      label: "ssm tunnel → silent (tunnel encrypts)",
      url: "mysql://u:p@h/d",
      tunnel: { ssm: { target: "i-012345" } },
      warn: false,
    },
  ])("$label", ({ url, tunnel, warn }) => {
    const result = mysqlStrategy.detectInsecureTls({
      url,
      tunnel,
    });
    if (warn) {
      expect(result).toMatch(/connecting without SSL/);
    } else {
      expect(result).toBeNull();
    }
  });

  it("emits a MySQL-shaped warning (mentions ssl=true / ssl-mode=required)", () => {
    const msg = mysqlStrategy.detectInsecureTls({
      url: "mysql://h/d",
      bastion: null,
    });
    expect(msg).toMatch(/ssl=true/);
    expect(msg).toMatch(/ssl-mode=required/);
    // It must NOT use the PG-specific phrasing.
    expect(msg).not.toMatch(/sslmode=require\b/);
  });
});

describe("mysqlStrategy.open", () => {
  function mockMysql2() {
    const queryFn = vi.fn(async () => [[], []] as [unknown, unknown]);
    const endFn = vi.fn(async () => {});
    const onFn = vi.fn();
    const fakeConn = { query: queryFn, end: endFn, on: onFn };
    vi.doMock("mysql2/promise", () => ({
      createConnection: async () => fakeConn,
    }));
    return { queryFn, endFn, onFn };
  }

  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.doUnmock("mysql2/promise");
    vi.doUnmock("mcp-shared");
    vi.resetModules();
    delete process.env.DBREAD_STATEMENT_TIMEOUT;
  });

  it("issues SET max_execution_time (default 10000ms) and read-only on connect", async () => {
    const { queryFn, endFn } = mockMysql2();
    const { mysqlStrategy: strat } = await import("../strategies/mysql.js");
    const conn = await strat.open({
      url: "mysql://u:p@h/d?ssl=true",
      tunnel: null,
      tableMetadata,
    });
    const calls = queryFn.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toEqual("SET SESSION max_execution_time = ?");
    expect(calls[0][1]).toEqual([10_000]);
    expect(calls[1][0]).toEqual("SET SESSION transaction_read_only = 1");
    await conn.close();
    expect(endFn).toHaveBeenCalled();
  });

  it.each([
    { label: "unset", env: undefined, expected: 10_000 },
    { label: "10s", env: "10s", expected: 10_000 },
    { label: "500ms", env: "500ms", expected: 500 },
    { label: "30s", env: "30s", expected: 30_000 },
    { label: "0 (disabled)", env: "0", expected: 0 },
    { label: "empty string", env: "", expected: 10_000 },
  ])(
    "DBREAD_STATEMENT_TIMEOUT=$label → max_execution_time = $expected",
    async ({ env, expected }) => {
      const { queryFn } = mockMysql2();
      if (env !== undefined) process.env.DBREAD_STATEMENT_TIMEOUT = env;
      const { mysqlStrategy: strat } = await import("../strategies/mysql.js");
      await strat.open({
        url: "mysql://u:p@h/d?ssl=true",
        bastion: null,
        tableMetadata,
      });
      expect(queryFn.mock.calls[0][1]).toEqual([expected]);
    },
  );

  it("attaches an 'error' listener that logs to stderr without throwing", async () => {
    const { onFn } = mockMysql2();
    const { mysqlStrategy: strat } = await import("../strategies/mysql.js");
    await strat.open({
      url: "mysql://u:p@h/d?ssl=true",
      tunnel: null,
      tableMetadata,
    });
    const errorCalls = onFn.mock.calls.filter((c) => c[0] === "error");
    expect(errorCalls).toHaveLength(1);
    const handler = errorCalls[0][1] as (err: Error) => void;
    handler(new Error("simulated disconnect"));
    expect(stderrSpy).toHaveBeenCalledWith(
      "[db-read-mcp] mysql client error:",
      "simulated disconnect",
    );
  });

  it("tears down the mysql client when SET fails after connect", async () => {
    const endFn = vi.fn(async () => {});
    const queryFn = vi.fn(async () => {
      throw new Error("set-failed");
    });
    vi.doMock("mysql2/promise", () => ({
      createConnection: async () => ({ query: queryFn, end: endFn, on: vi.fn() }),
    }));
    const { mysqlStrategy: strat } = await import("../strategies/mysql.js");
    await expect(
      strat.open({
        url: "mysql://u:p@h/d?ssl=true",
        bastion: null,
        tableMetadata,
      }),
    ).rejects.toThrow("set-failed");
    expect(endFn).toHaveBeenCalled();
  });

  it("tears down the SSH tunnel when SET fails after the tunnel is up", async () => {
    const tunnelClose = vi.fn(async () => {});
    const endFn = vi.fn(async () => {});
    const queryFn = vi.fn(async () => {
      throw new Error("set-failed");
    });
    vi.doMock("mysql2/promise", () => ({
      createConnection: async () => ({ query: queryFn, end: endFn, on: vi.fn() }),
    }));
    vi.doMock("mcp-shared/tunnel", async () => {
      const actual =
        await vi.importActual<typeof import("mcp-shared/tunnel")>("mcp-shared/tunnel");
      return {
        ...actual,
        resolveTunneledUrl: async () => ({
          url: "mysql://u:p@127.0.0.1:3306/d",
          tunnel: { close: tunnelClose },
        }),
      };
    });
    const { mysqlStrategy: strat } = await import("../strategies/mysql.js");
    await expect(
      strat.open({
        url: "mysql://u:p@h/d?ssl=true",
        tunnel: { bastion: { host: "bastion.example", identityFile: "/tmp/k" } },
        tableMetadata,
      }),
    ).rejects.toThrow("set-failed");
    expect(endFn).toHaveBeenCalled();
    expect(tunnelClose).toHaveBeenCalled();
  });
});

describe("defaultOpenConnection URL dispatch", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.doUnmock("mysql2/promise");
    vi.doUnmock("pg");
    vi.resetModules();
  });

  it("postgres:// URL routes to PG strategy (pg.Client constructed)", async () => {
    const ctorSpy = vi.fn();
    class FakePgClient {
      constructor(cfg: { connectionString: string }) {
        ctorSpy(cfg);
      }
      async connect(): Promise<void> {}
      async query(): Promise<{ rows: [] }> {
        return { rows: [] };
      }
      async end(): Promise<void> {}
      on(): void {}
    }
    vi.doMock("pg", () => ({
      default: { Client: FakePgClient },
      Client: FakePgClient,
    }));
    const { defaultOpenConnection } = await import("../server.js");
    await defaultOpenConnection({
      url: "postgres://u:p@h:5432/d?sslmode=require",
      tunnel: null,
      tableMetadata,
    });
    expect(ctorSpy).toHaveBeenCalled();
  });

  it("mysql:// URL routes to MySQL strategy (mysql2 createConnection invoked)", async () => {
    const createSpy = vi.fn(async () => ({
      async query() {
        return [[], []];
      },
      async end() {},
      on() {},
    }));
    vi.doMock("mysql2/promise", () => ({
      createConnection: createSpy,
    }));
    const { defaultOpenConnection } = await import("../server.js");
    await defaultOpenConnection({
      url: "mysql://u:p@h:3306/d?ssl=true",
      tunnel: null,
      tableMetadata,
    });
    expect(createSpy).toHaveBeenCalled();
    // The pg constructor must NOT have been touched.
  });

  it("postgres URL warning text is PG-shaped (sslmode=require)", async () => {
    class FakePgClient {
      async connect(): Promise<void> {}
      async query(): Promise<{ rows: [] }> {
        return { rows: [] };
      }
      async end(): Promise<void> {}
      on(): void {}
    }
    vi.doMock("pg", () => ({
      default: { Client: FakePgClient },
      Client: FakePgClient,
    }));
    const { defaultOpenConnection } = await import("../server.js");
    await defaultOpenConnection({
      url: "postgres://u:p@h:5432/d",
      tunnel: null,
      tableMetadata,
    });
    const warnings = stderrSpy.mock.calls
      .map((c) => c[0])
      .filter((m): m is string => typeof m === "string");
    expect(warnings.some((m) => /sslmode=require/.test(m))).toBe(true);
    expect(warnings.some((m) => /ssl-mode=required/.test(m))).toBe(false);
  });

  it("mysql URL warning text is MySQL-shaped (ssl-mode=required)", async () => {
    vi.doMock("mysql2/promise", () => ({
      createConnection: async () => ({
        async query() {
          return [[], []];
        },
        async end() {},
        on() {},
      }),
    }));
    const { defaultOpenConnection } = await import("../server.js");
    await defaultOpenConnection({
      url: "mysql://u:p@h:3306/d",
      tunnel: null,
      tableMetadata,
    });
    const warnings = stderrSpy.mock.calls
      .map((c) => c[0])
      .filter((m): m is string => typeof m === "string");
    expect(warnings.some((m) => /ssl-mode=required/.test(m))).toBe(true);
    expect(warnings.some((m) => /sslmode=require\b/.test(m))).toBe(false);
  });
});
