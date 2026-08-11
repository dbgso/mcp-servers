import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSecretResolver } from "../resolver.js";
import type { SecretSource } from "../source.js";

/** Build a SecretSource backed by a synchronous map for predictable testing. */
function mapSource(entries: Record<string, string | undefined>): SecretSource {
  return {
    fetch: vi.fn(async (path: string) => entries[path]),
  };
}

const ENV_KEYS_TO_RESTORE = [
  "SECRET_URI",
  "SECRET_LITERAL",
  "SECRET_MISSING",
  "SECRET_FROM_OTHER",
  "OTHER_KEY",
];

describe("createSecretResolver", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {};
    for (const k of ENV_KEYS_TO_RESTORE) {
      originalEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  describe("resolve()", () => {
    type ResolveCase = {
      description: string;
      input: string;
      expected: string;
    };

    const literalCases: ResolveCase[] = [
      { description: "plain literal", input: "plain-value", expected: "plain-value" },
      {
        description: "URL form is literal",
        input: "postgres://u:p@host/db",
        expected: "postgres://u:p@host/db",
      },
      {
        description: "unknown scheme is literal",
        input: "unknown:/foo",
        expected: "unknown:/foo",
      },
    ];

    it.each(literalCases)("returns literal as-is: $description", async ({ input, expected }) => {
      const resolver = createSecretResolver({
        schemes: { ssm: mapSource({}) },
      });
      await expect(resolver.resolve(input)).resolves.toBe(expected);
    });

    it("dispatches URI to the matching source by scheme", async () => {
      const ssm = mapSource({ "/foo": "ssm-value" });
      const sm = mapSource({ "my-secret": "sm-value" });
      const resolver = createSecretResolver({ schemes: { ssm, sm } });

      await expect(resolver.resolve("ssm:/foo")).resolves.toBe("ssm-value");
      await expect(resolver.resolve("sm:my-secret")).resolves.toBe("sm-value");
      expect(ssm.fetch).toHaveBeenCalledWith("/foo");
      expect(sm.fetch).toHaveBeenCalledWith("my-secret");
    });

    it("throws when source returns undefined for a registered scheme", async () => {
      const resolver = createSecretResolver({
        schemes: { ssm: mapSource({}) },
      });
      await expect(resolver.resolve("ssm:/missing")).rejects.toThrow(
        "Secret not found: ssm:/missing",
      );
    });

    it("propagates errors thrown by the source", async () => {
      const failing: SecretSource = {
        fetch: async () => {
          throw new Error("upstream failure");
        },
      };
      const resolver = createSecretResolver({ schemes: { ssm: failing } });
      await expect(resolver.resolve("ssm:/foo")).rejects.toThrow("upstream failure");
    });
  });

  describe("require()", () => {
    it("resolves the env value", async () => {
      process.env.SECRET_URI = "ssm:/foo";
      const resolver = createSecretResolver({
        schemes: { ssm: mapSource({ "/foo": "value-from-ssm" }) },
      });
      await expect(resolver.require("SECRET_URI")).resolves.toBe("value-from-ssm");
    });

    it("throws when the env var is unset", async () => {
      const resolver = createSecretResolver({ schemes: {} });
      await expect(resolver.require("SECRET_MISSING")).rejects.toThrow(
        "Required env var not set: SECRET_MISSING",
      );
    });
  });

  describe("get()", () => {
    it("returns undefined when the env var is unset", async () => {
      const resolver = createSecretResolver({ schemes: {} });
      await expect(resolver.get("SECRET_MISSING")).resolves.toBeUndefined();
    });

    it("returns the resolved value when set", async () => {
      process.env.SECRET_LITERAL = "just-a-literal";
      const resolver = createSecretResolver({ schemes: {} });
      await expect(resolver.get("SECRET_LITERAL")).resolves.toBe("just-a-literal");
    });
  });

  describe("preload() + cached()", () => {
    it("preloads multiple env keys for sync access", async () => {
      process.env.SECRET_URI = "ssm:/foo";
      process.env.SECRET_LITERAL = "raw";
      const resolver = createSecretResolver({
        schemes: { ssm: mapSource({ "/foo": "resolved-foo" }) },
      });

      await resolver.preload(["SECRET_URI", "SECRET_LITERAL"]);

      expect(resolver.cached("SECRET_URI")).toBe("resolved-foo");
      expect(resolver.cached("SECRET_LITERAL")).toBe("raw");
    });

    it("skips unset keys silently in preload (no cache entry)", async () => {
      const resolver = createSecretResolver({ schemes: {} });
      await resolver.preload(["SECRET_MISSING"]);
      expect(() => resolver.cached("SECRET_MISSING")).toThrow("Key not preloaded: SECRET_MISSING");
    });

    it("cached() throws for keys never preloaded", () => {
      const resolver = createSecretResolver({ schemes: {} });
      expect(() => resolver.cached("NEVER")).toThrow("Key not preloaded: NEVER");
    });
  });
});
