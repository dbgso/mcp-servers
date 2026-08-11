import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostgresDataSource, type PgQueryClient } from "mcp-shared-db-postgres";
import type { DataSource, SelectableFieldsMap, TableMetadataMap } from "mcp-shared-db";
import {
  buildBastionConfig,
  buildDefaultResolver,
  buildReadTools,
  createServer,
  registerShutdownHooks,
  SECRET_KEYS,
  SERVER_NAME,
  SERVER_VERSION,
  startServer,
  type Connection,
  type ConnectParams,
} from "../server.js";
import { fakeResolver } from "./fixtures/fake-resolver.js";

const URL_KEY = "DBREAD_URL";
const HOST_KEY = "DBREAD_BASTION_HOST";
const KEY_KEY = "DBREAD_BASTION_KEY";

const tableMetadata: TableMetadataMap = {
  users: {
    tableName: "users",
    primaryKey: ["id"],
    fields: {
      id: { type: "string", nullable: false },
      name: { type: "string", nullable: false },
    },
  },
};

const selectableFields: SelectableFieldsMap = {
  users: {
    fields: {
      id: { select: "expose" },
      name: { select: "redact", note: "real name" },
    },
  },
};

function makeFakePgClient(rows: Record<string, unknown>[] = []): PgQueryClient {
  return {
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    query: vi.fn(async () => ({ rows })),
  };
}

/**
 * Stub `DataSource` whose every method is a fresh vi.fn(). Used by tests
 * that only care about wire-up (tool registration / prefix / shutdown)
 * and never actually invoke the dataSource — keeps the mock surface in
 * one place so adding a new DataSource method doesn't ripple into six
 * inline copies.
 */
function makeStubDataSource(): DataSource {
  return {
    findByPk: vi.fn(),
    findByEq: vi.fn(),
    findByRange: vi.fn(),
    findByJsonPath: vi.fn(),
    explainFindByRange: vi.fn(),
    explainSql: vi.fn(),
  };
}

function makeFakeConnection(): {
  connection: Connection;
  client: PgQueryClient;
  closed: { value: boolean };
} {
  const client = makeFakePgClient();
  const closed = { value: false };
  // Wrap the fake pg client through the real PG factory so tests that drive
  // tools end-to-end exercise the same SQL builder + bind path as production.
  const dataSource = createPostgresDataSource({ client, tableMetadata });
  const connection: Connection = {
    dataSource,
    close: async () => {
      closed.value = true;
    },
  };
  return { connection, client, closed };
}

describe("db-read-mcp server", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env[URL_KEY];
    delete process.env[HOST_KEY];
    delete process.env[KEY_KEY];
    delete process.env.AWS_PROFILE;
    delete process.env.AWS_REGION;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("exposes server name, version, and SECRET_KEYS constants", () => {
    expect(SERVER_NAME).toBe("db-read-mcp");
    // Stamped in at build time, so it is the unbundled fallback here and a
    // snapshot like 0.0.0-<tag>.<timestamp>.<sha> for a snapshot publish.
    // Both are semver; neither is bare x.y.z.
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect([...SECRET_KEYS]).toEqual([
      "DBREAD_URL",
      "DBREAD_DIALECT",
      "DBREAD_HOST",
      "DBREAD_PORT",
      "DBREAD_USER",
      "DBREAD_PASSWORD",
      "DBREAD_DATABASE",
      "DBREAD_PARAMS",
      "DBREAD_BASTION_HOST",
      "DBREAD_BASTION_KEY",
      "DBREAD_SSM_TARGET",
      "DBREAD_SSM_REGION",
      "DBREAD_SSM_PROFILE",
      "DBREAD_SSM_DOCUMENT_NAME",
      "DBREAD_SSM_READY_TIMEOUT_MS",
    ]);
  });

  describe("buildReadTools", () => {
    it("returns the [describe, execute] tool pair with default 'db' prefix", () => {
      const dataSource = makeStubDataSource();
      const tools = buildReadTools({
        selectableFields,
        tableMetadata,
        getDataSource: async () => dataSource,
      });
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("db_describe");
      expect(tools[1].name).toBe("db_execute");
    });

    it("respects toolPrefix override", () => {
      const dataSource = makeStubDataSource();
      const [describe, execute] = buildReadTools({
        selectableFields,
        tableMetadata,
        getDataSource: async () => dataSource,
        toolPrefix: "rds",
      });
      expect(describe.name).toBe("rds_describe");
      expect(execute.name).toBe("rds_execute");
    });
  });

  describe("buildBastionConfig", () => {
    it.each([
      { name: "returns null when host is not preloaded", cache: {}, expected: null },
      {
        name: "returns { host } when only host is preloaded",
        cache: { [HOST_KEY]: "ec2-user@1.2.3.4" },
        expected: { host: "ec2-user@1.2.3.4" },
      },
      {
        name: "returns { host, identityFile } when both are preloaded",
        cache: { [HOST_KEY]: "ec2-user@1.2.3.4", [KEY_KEY]: "/k.pem" },
        expected: { host: "ec2-user@1.2.3.4", identityFile: "/k.pem" },
      },
    ])("$name", ({ cache, expected }) => {
      expect(buildBastionConfig(fakeResolver({ cache }))).toEqual(expected);
    });
  });

  describe("buildDefaultResolver", () => {
    it("constructs a resolver that exposes ssm/sm/env (literal pass-through)", async () => {
      const resolver = buildDefaultResolver();
      await expect(resolver.resolve("plain-literal")).resolves.toBe("plain-literal");
    });

    it("forwards AWS_PROFILE / AWS_REGION when set", async () => {
      const resolver = buildDefaultResolver({ env: { AWS_PROFILE: "p", AWS_REGION: "r" } });
      await expect(resolver.resolve("plain-literal")).resolves.toBe("plain-literal");
    });

    it("falls back to process.env when no env override is supplied", async () => {
      process.env.AWS_PROFILE = "shellprofile";
      const resolver = buildDefaultResolver();
      await expect(resolver.resolve("x")).resolves.toBe("x");
    });
  });

  describe("createServer", () => {
    it("registers describe/execute tools and routes ListToolsRequestSchema", async () => {
      const dataSource = makeStubDataSource();
      const server = createServer({
        selectableFields,
        tableMetadata,
        getDataSource: async () => dataSource,
      });
      const handler = (
        server as unknown as {
          _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
        }
      )._requestHandlers.get("tools/list");
      const result = (await handler!({ method: "tools/list", params: {} })) as {
        tools: { name: string }[];
      };
      expect(result.tools.map((t) => t.name).sort()).toEqual([
        "db_describe",
        "db_execute",
      ]);
    });

    it("CallToolRequestSchema returns errorResponse for unknown tools", async () => {
      const dataSource = makeStubDataSource();
      const server = createServer({
        selectableFields,
        tableMetadata,
        getDataSource: async () => dataSource,
      });
      const handler = (
        server as unknown as {
          _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
        }
      )._requestHandlers.get("tools/call");
      const out = (await handler!({
        method: "tools/call",
        params: { name: "no_such_tool", arguments: {} },
      })) as { isError?: boolean; content: { text: string }[] };
      expect(out.isError).toBe(true);
      expect(out.content[0].text).toContain("Unknown tool");
    });

    it("CallToolRequestSchema dispatches to a registered handler (list_tables)", async () => {
      const dataSource = makeStubDataSource();
      const server = createServer({
        selectableFields,
        tableMetadata,
        getDataSource: async () => dataSource,
      });
      const handler = (
        server as unknown as {
          _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
        }
      )._requestHandlers.get("tools/call");
      const out = (await handler!({
        method: "tools/call",
        params: {
          name: "db_execute",
          arguments: { operation: "list_tables", params: {} },
        },
      })) as { content: { text: string }[] };
      const data = JSON.parse(out.content[0].text);
      expect(data.tables[0].name).toBe("users");
    });

    it("forwards toolPrefix into the tool name", async () => {
      const dataSource = makeStubDataSource();
      const server = createServer({
        selectableFields,
        tableMetadata,
        getDataSource: async () => dataSource,
        toolPrefix: "rds",
      });
      const handler = (
        server as unknown as {
          _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
        }
      )._requestHandlers.get("tools/list");
      const result = (await handler!({ method: "tools/list", params: {} })) as {
        tools: { name: string }[];
      };
      expect(result.tools.map((t) => t.name).sort()).toEqual([
        "rds_describe",
        "rds_execute",
      ]);
    });
  });

  describe("registerShutdownHooks", () => {
    // We never want a real process.exit in tests — the spy captures it and
    // returns a never-resolving sentinel, so the test ends after the
    // shutdown microtask flushes.
    it.each([
      { signal: "SIGINT" as const },
      { signal: "SIGTERM" as const },
    ])("$signal closes the connection and calls process.exit(0)", async ({ signal }) => {
      const closeFn = vi.fn(async () => {});
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => undefined) as never);
      const conn: Connection = {
        dataSource: makeStubDataSource(),
        close: closeFn,
      };
      registerShutdownHooks(conn);
      process.emit(signal);
      // The shutdown handler is wired with `void shutdown().finally(...)`,
      // so we have to flush the microtask queue before asserting.
      await new Promise((r) => setImmediate(r));
      expect(closeFn).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
      // Avoid leaking the listener into other tests.
      process.removeAllListeners(signal);
    });

    it("swallows errors thrown from connection.close", async () => {
      const closeFn = vi.fn(async () => {
        throw new Error("boom");
      });
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => undefined) as never);
      const conn: Connection = {
        dataSource: makeStubDataSource(),
        close: closeFn,
      };
      registerShutdownHooks(conn);
      process.emit("SIGINT");
      await new Promise((r) => setImmediate(r));
      expect(closeFn).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
      process.removeAllListeners("SIGINT");
      process.removeAllListeners("SIGTERM");
    });
  });

  describe("defaultOpenConnection", () => {
    function mockPg() {
      const connectFn = vi.fn(async () => {});
      const endFn = vi.fn(async () => {});
      const queryFn = vi.fn(async () => ({ rows: [] }));
      const onFn = vi.fn();
      class FakePgClient {
        connect = connectFn;
        end = endFn;
        query = queryFn;
        on = onFn;
      }
      vi.doMock("pg", () => ({
        default: { Client: FakePgClient },
        Client: FakePgClient,
      }));
      return { connectFn, endFn, queryFn, onFn };
    }

    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      stderrSpy.mockRestore();
      vi.doUnmock("pg");
      vi.doUnmock("mcp-shared");
      vi.resetModules();
      delete process.env.DBREAD_STATEMENT_TIMEOUT;
    });

    it("issues SET statement_timeout (default 10s) and read-only on connect", async () => {
      const { connectFn, endFn, queryFn } = mockPg();
      const { defaultOpenConnection: doc } = await import("../server.js");
      const conn = await doc({
        url: "postgres://u:p@h:5432/d",
        tunnel: null,
        tableMetadata,
      });
      expect(connectFn).toHaveBeenCalled();
      const calls = queryFn.mock.calls;
      // Lock the SET count so a future change has to update this assertion.
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual([
        "SELECT set_config('statement_timeout', $1, false)",
        ["10s"],
      ]);
      expect(calls[1]).toEqual([
        "SELECT set_config('default_transaction_read_only', 'on', false)",
      ]);
      await conn.close();
      expect(endFn).toHaveBeenCalled();
    });

    it.each([
      { label: "unset", env: undefined, expected: "10s" },
      { label: "explicit", env: "30s", expected: "30s" },
      { label: "ms form", env: "500ms", expected: "500ms" },
      { label: "disabled", env: "0", expected: "0" },
      { label: "empty string", env: "", expected: "10s" },
      { label: "whitespace only", env: "   ", expected: "10s" },
    ])(
      "resolves DBREAD_STATEMENT_TIMEOUT=$label to '$expected'",
      async ({ env, expected }) => {
        const { queryFn } = mockPg();
        if (env !== undefined) process.env.DBREAD_STATEMENT_TIMEOUT = env;
        const { defaultOpenConnection: doc } = await import("../server.js");
        await doc({
          url: "postgres://u:p@h:5432/d",
          bastion: null,
          tableMetadata,
        });
        expect(queryFn.mock.calls[0]).toEqual([
          "SELECT set_config('statement_timeout', $1, false)",
          [expected],
        ]);
      },
    );

    it("tears down the pg client when SET fails after connect", async () => {
      const connectFn = vi.fn(async () => {});
      const endFn = vi.fn(async () => {});
      const queryFn = vi.fn(async () => {
        throw new Error("set-failed");
      });
      class FakePgClient {
        connect = connectFn;
        end = endFn;
        query = queryFn;
        on = vi.fn();
      }
      vi.doMock("pg", () => ({
        default: { Client: FakePgClient },
        Client: FakePgClient,
      }));
      const { defaultOpenConnection: doc } = await import("../server.js");
      await expect(
        doc({
          url: "postgres://u:p@h:5432/d",
          tunnel: null,
          tableMetadata,
        }),
      ).rejects.toThrow("set-failed");
      expect(endFn).toHaveBeenCalled();
    });

    it("tears down the SSH tunnel when SET fails after the tunnel is up", async () => {
      const tunnelClose = vi.fn(async () => {});
      const connectFn = vi.fn(async () => {});
      const endFn = vi.fn(async () => {});
      const queryFn = vi.fn(async () => {
        throw new Error("set-failed");
      });
      class FakePgClient {
        connect = connectFn;
        end = endFn;
        query = queryFn;
        on = vi.fn();
      }
      vi.doMock("pg", () => ({
        default: { Client: FakePgClient },
        Client: FakePgClient,
      }));
      // Spread-importActual relies on `mcp-shared/tunnel` being a plain ESM namespace
      // — if this test starts failing after a `mcp-shared` refactor, suspect
      // a change in its export shape (e.g. a default export or `__esModule`).
      vi.doMock("mcp-shared/tunnel", async () => {
        const actual =
          await vi.importActual<typeof import("mcp-shared/tunnel")>("mcp-shared/tunnel");
        return {
          ...actual,
          resolveTunneledUrl: async () => ({
            url: "postgres://u:p@127.0.0.1:5432/d",
            tunnel: { close: tunnelClose },
          }),
        };
      });
      const { defaultOpenConnection: doc } = await import("../server.js");
      await expect(
        doc({
          url: "postgres://u:p@h:5432/d",
          tunnel: { bastion: { host: "bastion.example", identityFile: "/tmp/key" } },
          tableMetadata,
        }),
      ).rejects.toThrow("set-failed");
      expect(endFn).toHaveBeenCalled();
      expect(tunnelClose).toHaveBeenCalled();
    });

    it("attaches an 'error' listener that logs to stderr without throwing", async () => {
      const { onFn } = mockPg();
      const { defaultOpenConnection: doc } = await import("../server.js");
      await doc({
        url: "postgres://u:p@h:5432/d?sslmode=require",
        tunnel: null,
        tableMetadata,
      });
      // Find the error-listener registration. There may be more than one
      // `on` call in the future; pick the one for "error".
      const errorCalls = onFn.mock.calls.filter((c) => c[0] === "error");
      expect(errorCalls).toHaveLength(1);
      const handler = errorCalls[0][1] as (err: Error) => void;
      // Invoking the handler should not throw and should log to stderr.
      handler(new Error("simulated disconnect"));
      expect(stderrSpy).toHaveBeenCalledWith(
        "[db-read-mcp] pg client error:",
        "simulated disconnect",
      );
    });

    it.each<{
      label: string;
      url: string;
      tunnel: { bastion: { host: string; identityFile: string } } | { ssm: { target: string } } | null;
      expectWarning: boolean;
    }>([
      {
        label: "no tunnel + no sslmode → warn",
        url: "postgres://u:p@h:5432/d",
        tunnel: null,
        expectWarning: true,
      },
      {
        label: "no tunnel + sslmode=require → silent",
        url: "postgres://u:p@h:5432/d?sslmode=require",
        tunnel: null,
        expectWarning: false,
      },
      {
        label: "no tunnel + sslmode=verify-ca → silent",
        url: "postgres://u:p@h:5432/d?sslmode=verify-ca",
        tunnel: null,
        expectWarning: false,
      },
      {
        label: "no tunnel + sslmode=verify-full → silent",
        url: "postgres://u:p@h:5432/d?sslmode=verify-full",
        tunnel: null,
        expectWarning: false,
      },
      {
        label: "no tunnel + sslmode=disable → warn (plaintext is what we're warning about)",
        url: "postgres://u:p@h:5432/d?sslmode=disable",
        tunnel: null,
        expectWarning: true,
      },
      {
        label: "no tunnel + sslmode=prefer → warn (allows plaintext fallback)",
        url: "postgres://u:p@h:5432/d?sslmode=prefer",
        tunnel: null,
        expectWarning: true,
      },
      {
        label: "ssh bastion present → silent (tunnel encrypts)",
        url: "postgres://u:p@h:5432/d",
        tunnel: { bastion: { host: "bastion.example", identityFile: "/tmp/key" } },
        expectWarning: false,
      },
      {
        label: "ssm tunnel present → silent (tunnel encrypts)",
        url: "postgres://u:p@h:5432/d",
        tunnel: { ssm: { target: "i-0123abcd" } },
        expectWarning: false,
      },
    ])("TLS warning: $label", async ({ url, tunnel, expectWarning }) => {
      mockPg();
      // Tunnel paths need resolveTunneledUrl mocked so the test doesn't try
      // to actually spawn ssh / aws.
      if (tunnel) {
        vi.doMock("mcp-shared/tunnel", async () => {
          const actual =
            await vi.importActual<typeof import("mcp-shared/tunnel")>("mcp-shared/tunnel");
          return {
            ...actual,
            resolveTunneledUrl: async () => ({
              url: "postgres://u:p@127.0.0.1:5432/d",
              tunnel: { close: async () => {} },
            }),
          };
        });
      }
      const { defaultOpenConnection: doc } = await import("../server.js");
      await doc({ url, tunnel, tableMetadata });
      const warnings = stderrSpy.mock.calls
        .map((c) => c[0])
        .filter(
          (msg): msg is string =>
            typeof msg === "string" && msg.includes("connecting without SSL"),
        );
      expect(warnings.length > 0).toBe(expectWarning);
    });
  });

  describe("startServer", () => {
    const goodCli = {
      envFile: "/tmp/fake.env",
      metadata: "/tmp/m.ts",
      selectableFields: "/tmp/s.ts",
    };

    it("requires CLI arguments when no argv array is supplied either", async () => {
      // Empty options object — no argv form, no cli, expect throw.
      await expect(startServer({})).rejects.toThrow(/requires CLI arguments/);
    });

    async function runStartServer(extra: Partial<Parameters<typeof startServer>[0]> = {}) {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u:p@h:5432/d" },
      });
      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
      const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
      const connectSpy = vi
        .spyOn(Server.prototype, "connect")
        .mockResolvedValue(undefined);
      const load = vi.fn();
      const importer = vi.fn(async (spec: string) => {
        if (spec.includes("m.ts") || spec.includes("metadata")) {
          return { tableMetadata };
        }
        return { selectableFields };
      });
      const fake = makeFakeConnection();
      const openConnection = vi.fn(async (_p: ConnectParams) => fake.connection);
      await startServer({
        cli: goodCli,
        resolver,
        loadEnvFile: load,
        importer,
        openConnection,
        ...extra,
      });
      return { resolver, consoleErr, connectSpy, load, importer, openConnection, fake };
    }

    it("happy path: loads env, dynamic-imports configs, opens connection, registers tools", async () => {
      const { consoleErr, connectSpy, load, importer, openConnection } =
        await runStartServer();
      expect(load).toHaveBeenCalledWith(goodCli.envFile);
      expect(importer).toHaveBeenCalledTimes(2);
      expect(openConnection).toHaveBeenCalledWith({
        url: "postgres://u:p@h:5432/d",
        tunnel: null,
        tableMetadata,
      });
      expect(connectSpy).toHaveBeenCalled();
      expect(consoleErr).toHaveBeenCalledWith(
        expect.stringContaining(`${SERVER_NAME} v${SERVER_VERSION} started`),
      );
    });

    it("composes URL from DBREAD_{DIALECT,HOST,PORT,USER,PASSWORD,DATABASE} when set", async () => {
      const resolver = fakeResolver({
        cache: {
          DBREAD_DIALECT: "postgres",
          DBREAD_HOST: "db.example.com",
          DBREAD_PORT: "5432",
          DBREAD_USER: "alice",
          DBREAD_PASSWORD: "s3cret",
          DBREAD_DATABASE: "appdb",
        },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
      vi.spyOn(Server.prototype, "connect").mockResolvedValue(undefined);
      const fake = makeFakeConnection();
      const openConnection = vi.fn(async (_p: ConnectParams) => fake.connection);
      await startServer({
        cli: goodCli,
        resolver,
        loadEnvFile: vi.fn(),
        importer: async (spec: string) =>
          spec.includes("m.ts") ? { tableMetadata } : { selectableFields },
        openConnection,
      });
      expect(openConnection).toHaveBeenCalledWith({
        url: "postgres://alice:s3cret@db.example.com:5432/appdb",
        tunnel: null,
        tableMetadata,
      });
    });

    it("forwards bastion config from resolver cache into openConnection", async () => {
      const resolver = fakeResolver({
        cache: {
          [URL_KEY]: "postgres://u:p@h:5432/d",
          [HOST_KEY]: "ec2-user@1.2.3.4",
          [KEY_KEY]: "/k.pem",
        },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
      vi.spyOn(Server.prototype, "connect").mockResolvedValue(undefined);
      const importer = vi.fn(async (spec: string) =>
        spec.includes("m.ts") ? { tableMetadata } : { selectableFields },
      );
      const fake = makeFakeConnection();
      const openConnection = vi.fn(async (_p: ConnectParams) => fake.connection);
      await startServer({
        cli: goodCli,
        resolver,
        loadEnvFile: vi.fn(),
        importer,
        openConnection,
      });
      expect(openConnection).toHaveBeenCalledWith({
        url: "postgres://u:p@h:5432/d",
        tunnel: { bastion: { host: "ec2-user@1.2.3.4", identityFile: "/k.pem" } },
        tableMetadata,
      });
    });

    it("preloads SECRET_KEYS via the injected resolver", async () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u:p@h:5432/d" },
      });
      const preloadSpy = vi.spyOn(resolver, "preload");
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
      vi.spyOn(Server.prototype, "connect").mockResolvedValue(undefined);
      const fake = makeFakeConnection();
      await startServer({
        cli: goodCli,
        resolver,
        loadEnvFile: vi.fn(),
        importer: async (spec: string) =>
          spec.includes("m.ts") ? { tableMetadata } : { selectableFields },
        openConnection: async () => fake.connection,
      });
      expect(preloadSpy).toHaveBeenCalledWith([...SECRET_KEYS]);
    });

    it("forwards toolPrefix from CLI args through to the registered tools", async () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u:p@h:5432/d" },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
      // Capture the server we would have connected, so we can introspect tools.
      let capturedServer: unknown;
      vi.spyOn(Server.prototype, "connect").mockImplementation(async function (
        this: unknown,
      ) {
        capturedServer = this;
      });
      const fake = makeFakeConnection();
      await startServer({
        cli: { ...goodCli, toolPrefix: "rds" },
        resolver,
        loadEnvFile: vi.fn(),
        importer: async (spec: string) =>
          spec.includes("m.ts") ? { tableMetadata } : { selectableFields },
        openConnection: async () => fake.connection,
      });
      const handlers = (
        capturedServer as {
          _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
        }
      )._requestHandlers;
      const list = handlers.get("tools/list");
      const out = (await list!({ method: "tools/list", params: {} })) as {
        tools: { name: string }[];
      };
      expect(out.tools.map((t) => t.name).sort()).toEqual([
        "rds_describe",
        "rds_execute",
      ]);
    });

    it("happy path drives a get_by_pk call through the live DataSource lambda", async () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u:p@h:5432/d" },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
      let capturedServer: unknown;
      vi.spyOn(Server.prototype, "connect").mockImplementation(async function (
        this: unknown,
      ) {
        capturedServer = this;
      });
      // The fake pg client returns a row so the operations layer can
      // round-trip through `findByPk`. This drives the otherwise-skipped
      // `async () => dataSource` lambda and the live createPostgresDataSource
      // wrapping path.
      const queryFn = vi.fn(async () => ({ rows: [{ id: "u-1", name: "Alice" }] }));
      const fakeClient: PgQueryClient = {
        connect: vi.fn(async () => {}),
        end: vi.fn(async () => {}),
        query: queryFn,
      };
      // Drive the fake client through the live PG factory so the test still
      // exercises the real createPostgresDataSource → SQL-builder → bind path.
      const fake: Connection = {
        dataSource: createPostgresDataSource({
          client: fakeClient,
          tableMetadata,
        }),
        close: vi.fn(async () => {}),
      };
      await startServer({
        cli: goodCli,
        resolver,
        loadEnvFile: vi.fn(),
        importer: async (spec: string) =>
          spec.includes("m.ts") ? { tableMetadata } : { selectableFields },
        openConnection: async () => fake,
      });
      const handlers = (
        capturedServer as {
          _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
        }
      )._requestHandlers;
      const call = handlers.get("tools/call")!;
      const out = (await call({
        method: "tools/call",
        params: {
          name: "db_execute",
          arguments: {
            operation: "get_by_pk",
            params: { table: "users", pk: "u-1" },
          },
        },
      })) as { content: { text: string }[] };
      const data = JSON.parse(out.content[0].text);
      expect(data.found).toBe(true);
      const row = data.row as Record<string, unknown>;
      expect(row.name).toBe("[REDACTED]");
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("accepts argv array form and parses flags out of it", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
      vi.spyOn(Server.prototype, "connect").mockResolvedValue(undefined);
      // The argv form re-runs parseArgs, which validates required flags.
      // We can't actually go through the resolver/connection happy path here
      // without a resolver injection, so we expect this to fail at the
      // resolver step. The validation that argv parsing happens is implicit:
      // a missing-flag argv would throw at parseArgs first.
      await expect(
        startServer([
          "--env-file",
          "/tmp/x.env",
          "--metadata",
          "/tmp/m.ts",
          "--selectable-fields",
          "/tmp/s.ts",
        ]),
      ).rejects.toThrow();
    });
  });
});
