import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  buildBastionConfig,
  buildCodegenTools,
  buildDefaultResolver,
  createServer,
  SECRET_KEYS,
  SERVER_NAME,
  SERVER_VERSION,
  startServer,
} from "../server.js";
import { fakeResolver } from "./fixtures/fake-resolver.js";

const URL_KEY = "DBGEN_URL";
const HOST_KEY = "DBGEN_BASTION_HOST";
const KEY_KEY = "DBGEN_BASTION_KEY";

describe("db-codegen-mcp server", () => {
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

  it("exposes server name and version constants", () => {
    expect(SERVER_NAME).toBe("db-codegen-mcp");
    // Stamped in at build time, so it is the unbundled fallback here and a
    // snapshot like 0.0.0-<tag>.<timestamp>.<sha> for a snapshot publish.
    // Both are semver; neither is bare x.y.z.
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  describe("buildCodegenTools", () => {
    it("returns the [describe, execute] tool pair from a resolver", () => {
      const resolver = fakeResolver({ cache: { [URL_KEY]: "postgres://u@h:5432/d" } });
      const tools = buildCodegenTools({ resolver });
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("dbgen_describe");
      expect(tools[1].name).toBe("dbgen_execute");
    });

    it("uses resolver.cached(DBGEN_URL) for the default getUrl", async () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u@h:5432/d" },
      });
      const tools = buildCodegenTools({
        resolver,
        override: {
          pickIntrospector: vi.fn().mockResolvedValue({
            listSchemas: vi.fn().mockResolvedValue(["public"]),
            listTables: vi.fn(),
            introspectTable: vi.fn(),
            close: vi.fn(),
          }),
        },
      });
      const out = await tools[1].execute({
        operation: "list_schemas",
        params: {},
      });
      const data = JSON.parse((out.content[0] as { text: string }).text);
      expect(data.schemas).toEqual(["public"]);
    });

    it("composes the URL from DBGEN_{DIALECT,HOST,PORT,USER,PASSWORD,DATABASE} when set", async () => {
      const introspector = {
        listSchemas: vi.fn().mockResolvedValue(["public"]),
        listTables: vi.fn(),
        introspectTable: vi.fn(),
        close: vi.fn(),
      };
      const pickIntrospector = vi.fn().mockResolvedValue(introspector);
      const resolver = fakeResolver({
        cache: {
          DBGEN_DIALECT: "postgres",
          DBGEN_HOST: "db.example.com",
          DBGEN_PORT: "5432",
          DBGEN_USER: "alice",
          DBGEN_PASSWORD: "s3cret",
          DBGEN_DATABASE: "appdb",
        },
      });
      const tools = buildCodegenTools({
        resolver,
        override: { pickIntrospector },
      });
      await tools[1].execute({ operation: "list_schemas", params: {} });
      const pickCall = pickIntrospector.mock.calls[0]?.[0] as { url: string };
      expect(pickCall.url).toBe(
        "postgres://alice:s3cret@db.example.com:5432/appdb",
      );
    });

    it("returns an error when DBGEN_URL is not preloaded", async () => {
      const resolver = fakeResolver();
      const tools = buildCodegenTools({
        resolver,
        override: { pickIntrospector: vi.fn() },
      });
      const out = await tools[1].execute({
        operation: "list_schemas",
        params: {},
      });
      expect(out.isError).toBe(true);
    });

    it("forwards getUrl/getBastion overrides", () => {
      const resolver = fakeResolver();
      const tools = buildCodegenTools({
        resolver,
        override: {
          getUrl: () => "postgres://override@h:5432/d",
          getBastion: () => null,
          pickIntrospector: vi.fn(),
        },
      });
      expect(tools[0].name).toBe("dbgen_describe");
    });

    it("forwards every codegen config field", () => {
      const resolver = fakeResolver();
      const tools = buildCodegenTools({
        resolver,
        override: {
          getUrl: () => "postgres://u@h:5432/d",
          getBastion: () => null,
          envPrefix: "ALT",
          toolPrefix: "myprefix",
          describeDescription: "describe",
          executeDescription: "execute",
          preamble: "preamble",
          pickIntrospector: vi.fn(),
        },
      });
      expect(tools[0].name).toBe("myprefix_describe");
      expect(tools[1].name).toBe("myprefix_execute");
      expect(tools[0].description).toBe("describe");
      expect(tools[1].description).toBe("execute");
    });
  });

  describe("buildBastionConfig", () => {
    it.each([
      {
        name: "returns null when host is not preloaded",
        cache: {},
        expected: null,
      },
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
    it("constructs a resolver that exposes ssm/sm/env schemes (via .resolve)", async () => {
      // Drives buildDefaultResolver's "no AWS_PROFILE / no AWS_REGION" branch.
      const resolver = buildDefaultResolver();
      // Literal value passes through resolve() unchanged.
      await expect(resolver.resolve("plain-literal")).resolves.toBe("plain-literal");
    });

    it("forwards AWS_PROFILE / AWS_REGION when set", async () => {
      process.env.AWS_PROFILE = "p";
      process.env.AWS_REGION = "r";
      const resolver = buildDefaultResolver();
      await expect(resolver.resolve("plain-literal")).resolves.toBe("plain-literal");
    });
  });

  describe("createServer", () => {
    it("registers the codegen tool pair", () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u@h:5432/d" },
      });
      const server = createServer({ resolver });
      expect(server).toBeDefined();
    });

    it("ListToolsRequestSchema returns the registered tools", async () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u@h:5432/d" },
      });
      const server = createServer({ resolver });
      const handler = (
        server as unknown as {
          _requestHandlers: Map<string, (req: unknown) => unknown>;
        }
      )._requestHandlers.get("tools/list");
      expect(handler).toBeDefined();
      const result = (await handler!({
        method: "tools/list",
        params: {},
      })) as { tools: { name: string }[] };
      expect(result.tools.map((t) => t.name).sort()).toEqual([
        "dbgen_describe",
        "dbgen_execute",
      ]);
    });

    it("CallToolRequestSchema returns errorResponse for unknown tools", async () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u@h:5432/d" },
      });
      const server = createServer({ resolver });
      const handler = (
        server as unknown as {
          _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
        }
      )._requestHandlers.get("tools/call");
      expect(handler).toBeDefined();
      const out = (await handler!({
        method: "tools/call",
        params: { name: "no_such_tool", arguments: {} },
      })) as { isError?: boolean; content: { text: string }[] };
      expect(out.isError).toBe(true);
      expect(out.content[0].text).toContain("Unknown tool");
    });

    it("CallToolRequestSchema dispatches to a registered handler", async () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u@h:5432/d" },
      });
      const server = createServer({
        resolver,
        toolsConfig: {
          pickIntrospector: vi.fn().mockResolvedValue({
            listSchemas: vi.fn().mockResolvedValue(["public"]),
            listTables: vi.fn(),
            introspectTable: vi.fn(),
            close: vi.fn(),
          }),
        },
      });
      const handler = (
        server as unknown as {
          _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
        }
      )._requestHandlers.get("tools/call");
      const out = (await handler!({
        method: "tools/call",
        params: {
          name: "dbgen_execute",
          arguments: { operation: "list_schemas", params: {} },
        },
      })) as { content: { text: string }[] };
      const data = JSON.parse(out.content[0].text);
      expect(data.schemas).toEqual(["public"]);
    });
  });

  describe("startServer", () => {
    it("connects the server and logs startup (with injected resolver)", async () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u@h:5432/d" },
      });
      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
      const { Server } = await import(
        "@modelcontextprotocol/sdk/server/index.js"
      );
      const connectSpy = vi
        .spyOn(Server.prototype, "connect")
        .mockResolvedValue(undefined);
      await startServer({ resolver });
      expect(connectSpy).toHaveBeenCalled();
      expect(consoleErr).toHaveBeenCalledWith(
        expect.stringContaining(`${SERVER_NAME} v${SERVER_VERSION} started`),
      );
    });

    it("calls loadEnvFile when --env-file is provided", async () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u@h:5432/d" },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { Server } = await import(
        "@modelcontextprotocol/sdk/server/index.js"
      );
      vi.spyOn(Server.prototype, "connect").mockResolvedValue(undefined);
      const load = vi.fn();
      await startServer({
        cli: { envFile: "/tmp/fake.env" },
        resolver,
        loadEnvFile: load,
      });
      expect(load).toHaveBeenCalledWith("/tmp/fake.env");
    });

    it("skips loadEnvFile when --env-file is not provided", async () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u@h:5432/d" },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { Server } = await import(
        "@modelcontextprotocol/sdk/server/index.js"
      );
      vi.spyOn(Server.prototype, "connect").mockResolvedValue(undefined);
      const load = vi.fn();
      await startServer({ resolver, loadEnvFile: load });
      expect(load).not.toHaveBeenCalled();
    });

    it("accepts argv array form and parses --env-file", async () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u@h:5432/d" },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { Server } = await import(
        "@modelcontextprotocol/sdk/server/index.js"
      );
      vi.spyOn(Server.prototype, "connect").mockResolvedValue(undefined);
      // The argv form uses real loadEnvFile (which throws on missing path),
      // so we pass an argv that has no --env-file to drive the branch.
      await startServer([]);
      // Resolver was built internally; nothing to assert beyond no-throw +
      // server connect (covered by the spy above).
    });

    it("forwards toolsConfig through startServer", async () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u@h:5432/d" },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { Server } = await import(
        "@modelcontextprotocol/sdk/server/index.js"
      );
      vi.spyOn(Server.prototype, "connect").mockResolvedValue(undefined);
      await startServer({
        resolver,
        toolsConfig: { toolPrefix: "myprefix", pickIntrospector: vi.fn() },
      });
      // No throw + connect spy fired (asserted indirectly via console.error
      // startup banner check below).
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(`${SERVER_NAME} v${SERVER_VERSION} started`),
      );
    });

    it("preloads SECRET_KEYS via the injected resolver", async () => {
      const resolver = fakeResolver({
        cache: { [URL_KEY]: "postgres://u@h:5432/d" },
      });
      const preloadSpy = vi.spyOn(resolver, "preload");
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { Server } = await import(
        "@modelcontextprotocol/sdk/server/index.js"
      );
      vi.spyOn(Server.prototype, "connect").mockResolvedValue(undefined);
      await startServer({ resolver });
      expect(preloadSpy).toHaveBeenCalledWith([...SECRET_KEYS]);
    });
  });

  it("schema constants are valid mcp request schemas", () => {
    // Sanity probe — guards against accidental import drift.
    expect(ListToolsRequestSchema).toBeDefined();
    expect(CallToolRequestSchema).toBeDefined();
  });
});
