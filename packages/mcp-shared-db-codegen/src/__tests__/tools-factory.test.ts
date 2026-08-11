import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCodegenTools, resolveTunnelSpec } from "../tools-factory.js";
import type { Introspector } from "../introspect/types.js";

function createFakeIntrospector(overrides: Partial<Introspector> = {}): Introspector {
  return {
    listSchemas: vi.fn().mockResolvedValue(["public"]),
    listTables: vi.fn().mockResolvedValue([]),
    introspectTable: vi.fn().mockResolvedValue({
      schema: "public",
      name: "t",
      primaryKey: [],
      columns: [],
      indexes: [],
      foreignKeys: [],
    }),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const ENV_KEYS = [
  "DBGEN_BASTION_HOST",
  "DBGEN_BASTION_KEY",
  "DBGEN_BASTION_EXTRA_ARGS",
  "DBGEN_SSM_TARGET",
  "DBGEN_SSM_REGION",
  "DBGEN_SSM_PROFILE",
  "AWS_REGION",
  "AWS_PROFILE",
  "OTHER_BASTION_HOST",
  "OTHER_SSM_TARGET",
];

describe("createCodegenTools", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const original = originalEnv[k];
      if (original === undefined) delete process.env[k];
      else process.env[k] = original;
    }
  });

  it("returns a [describe, execute] pair with the default 'dbgen' prefix", () => {
    const [describe, execute] = createCodegenTools({
      getUrl: () => "postgres://u@h:5432/d",
    });
    expect(describe.name).toBe("dbgen_describe");
    expect(execute.name).toBe("dbgen_execute");
  });

  it("respects a custom toolPrefix", () => {
    const [describe, execute] = createCodegenTools({
      getUrl: () => "postgres://u@h:5432/d",
      toolPrefix: "codegen",
    });
    expect(describe.name).toBe("codegen_describe");
    expect(execute.name).toBe("codegen_execute");
  });

  it("uses custom describe/execute descriptions and preamble", async () => {
    const [describe, execute] = createCodegenTools({
      getUrl: () => "postgres://u@h:5432/d",
      describeDescription: "custom describe",
      executeDescription: "custom execute",
      preamble: "custom preamble line",
    });
    expect(describe.description).toBe("custom describe");
    expect(execute.description).toBe("custom execute");
    const out = await describe.execute({});
    const text = (out.content[0] as { text: string }).text;
    expect(text).toContain("custom preamble line");
  });

  it("describe lists every codegen op", async () => {
    const [describe] = createCodegenTools({
      getUrl: () => "postgres://u@h:5432/d",
    });
    const out = await describe.execute({});
    const text = (out.content[0] as { text: string }).text;
    expect(text).toContain("list_schemas");
    expect(text).toContain("list_tables");
    expect(text).toContain("introspect_table");
    expect(text).toContain("introspect_all");
    expect(text).toContain("preview_metadata_json");
    expect(text).toContain("preview_selectable_fields_json");
    expect(text).toContain("validate_selectable_fields");
  });

  it("execute builds the introspector via the picker and calls the op", async () => {
    const fake = createFakeIntrospector();
    const picker = vi.fn().mockResolvedValue(fake);
    const [, execute] = createCodegenTools({
      getUrl: () => "postgres://u@h:5432/d",
      pickIntrospector: picker,
    });
    const out = await execute.execute({ operation: "list_schemas", params: {} });
    expect(picker).toHaveBeenCalledWith({ url: "postgres://u@h:5432/d" });
    const data = JSON.parse((out.content[0] as { text: string }).text);
    expect(data.schemas).toEqual(["public"]);
  });

  it("throws when getUrl returns empty string", async () => {
    const [, execute] = createCodegenTools({
      getUrl: () => "",
      pickIntrospector: vi.fn(),
    });
    const out = await execute.execute({ operation: "list_schemas", params: {} });
    expect(out.isError).toBe(true);
    expect((out.content[0] as { text: string }).text).toContain("DBGEN_URL");
  });

  it("uses envPrefix override in the missing-URL message", async () => {
    const [, execute] = createCodegenTools({
      getUrl: () => "",
      envPrefix: "OTHER",
      pickIntrospector: vi.fn(),
    });
    const out = await execute.execute({ operation: "list_schemas", params: {} });
    expect((out.content[0] as { text: string }).text).toContain("OTHER_URL");
  });

  it("ignores tunnel resolution when no bastion env is set", async () => {
    const fake = createFakeIntrospector();
    const picker = vi.fn().mockResolvedValue(fake);
    const [, execute] = createCodegenTools({
      getUrl: () => "postgres://u@h:5432/d",
      pickIntrospector: picker,
    });
    await execute.execute({ operation: "list_schemas", params: {} });
    expect(picker).toHaveBeenCalledWith({ url: "postgres://u@h:5432/d" });
  });

  it("calls a custom getBastion override when supplied", async () => {
    const fake = createFakeIntrospector();
    const picker = vi.fn().mockResolvedValue(fake);
    const getBastion = vi.fn().mockReturnValue(null);
    const [, execute] = createCodegenTools({
      getUrl: () => "postgres://u@h:5432/d",
      getBastion,
      pickIntrospector: picker,
    });
    await execute.execute({ operation: "list_schemas", params: {} });
    expect(getBastion).toHaveBeenCalled();
  });

  describe("resolveTunnelSpec branches", () => {
    // Direct unit tests on the exported helper — no real spawn / network
    // involved, so every branch is exercised cheaply.

    it("returns config.getTunnel() output verbatim (highest precedence)", () => {
      const getTunnel = vi
        .fn()
        .mockReturnValue({ ssm: { target: "i-from-getTunnel" } });
      const getBastion = vi.fn();
      // env signals also set — must be IGNORED when getTunnel is provided
      process.env.DBGEN_BASTION_HOST = "ec2-user@env";
      process.env.DBGEN_SSM_TARGET = "i-fromenv";
      const result = resolveTunnelSpec({
        envPrefix: "DBGEN",
        config: {
          getUrl: () => "postgres://u@h:5432/d",
          getTunnel,
          getBastion,
        },
      });
      expect(result).toEqual({ ssm: { target: "i-from-getTunnel" } });
      expect(getTunnel).toHaveBeenCalledTimes(1);
      expect(getBastion).not.toHaveBeenCalled();
    });

    it("wraps getBastion()'s truthy result in { bastion }", () => {
      const getBastion = vi
        .fn()
        .mockReturnValue({ host: "ec2-user@b.example", identityFile: "/k" });
      const result = resolveTunnelSpec({
        envPrefix: "DBGEN",
        config: {
          getUrl: () => "postgres://u@h:5432/d",
          getBastion,
        },
      });
      expect(result).toEqual({
        bastion: { host: "ec2-user@b.example", identityFile: "/k" },
      });
    });

    it("returns null when getBastion() returns null", () => {
      // Even with env signals present, getBastion's null short-circuits
      // (the alias is for callers wanting "use my override or no tunnel").
      process.env.DBGEN_SSM_TARGET = "i-shouldnotmatter";
      const result = resolveTunnelSpec({
        envPrefix: "DBGEN",
        config: {
          getUrl: () => "postgres://u@h:5432/d",
          getBastion: () => null,
        },
      });
      expect(result).toBeNull();
    });

    it("falls through to bastionConfigFromEnv when neither override is set", () => {
      process.env.DBGEN_BASTION_HOST = "ec2-user@from-env";
      process.env.DBGEN_BASTION_KEY = "/from-env.pem";
      const result = resolveTunnelSpec({
        envPrefix: "DBGEN",
        config: { getUrl: () => "postgres://u@h:5432/d" },
      });
      expect(result).toEqual({
        bastion: {
          host: "ec2-user@from-env",
          identityFile: "/from-env.pem",
        },
      });
    });

    it("falls through to ssmConfigFromEnv when only the SSM env signal is set", () => {
      process.env.DBGEN_SSM_TARGET = "i-fromenv";
      process.env.DBGEN_SSM_REGION = "ap-northeast-1";
      const result = resolveTunnelSpec({
        envPrefix: "DBGEN",
        config: { getUrl: () => "postgres://u@h:5432/d" },
      });
      expect(result).toEqual({
        ssm: { target: "i-fromenv", region: "ap-northeast-1" },
      });
    });

    it("throws when both DBGEN_BASTION_HOST and DBGEN_SSM_TARGET are set", () => {
      process.env.DBGEN_BASTION_HOST = "ec2-user@bastion";
      process.env.DBGEN_SSM_TARGET = "i-0123";
      expect(() =>
        resolveTunnelSpec({
          envPrefix: "DBGEN",
          config: { getUrl: () => "postgres://u@h:5432/d" },
        }),
      ).toThrow(/Set at most one of DBGEN_BASTION_HOST or DBGEN_SSM_TARGET/);
    });

    it("returns null when no tunnel signal is present anywhere", () => {
      const result = resolveTunnelSpec({
        envPrefix: "DBGEN",
        config: { getUrl: () => "postgres://u@h:5432/d" },
      });
      expect(result).toBeNull();
    });

    it("respects a custom envPrefix when reading the env", () => {
      process.env.OTHER_BASTION_HOST = "ec2-user@other";
      const result = resolveTunnelSpec({
        envPrefix: "OTHER",
        config: { getUrl: () => "postgres://u@h:5432/d" },
      });
      expect(result).toEqual({ bastion: { host: "ec2-user@other" } });
    });

    it("uses custom-prefixed mutual-exclusion message", () => {
      process.env.OTHER_BASTION_HOST = "ec2-user@b";
      process.env.OTHER_SSM_TARGET = "i-1";
      expect(() =>
        resolveTunnelSpec({
          envPrefix: "OTHER",
          config: { getUrl: () => "postgres://u@h:5432/d" },
        }),
      ).toThrow(/OTHER_BASTION_HOST or OTHER_SSM_TARGET/);
    });
  });

  it("passes describe operation lookup through (op detail)", async () => {
    const [describe] = createCodegenTools({
      getUrl: () => "postgres://u@h:5432/d",
    });
    const detail = await describe.execute({ operation: "list_tables" });
    const text = (detail.content[0] as { text: string }).text;
    expect(text).toContain("list_tables");
    expect(text).toContain("Arg schema");
  });
});
