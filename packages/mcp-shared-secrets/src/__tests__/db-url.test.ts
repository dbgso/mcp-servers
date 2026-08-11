import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSecretResolver } from "../resolver.js";
import { envSource } from "../env-source.js";
import {
  composeDbUrlFromResolver,
  DB_URL_PART_SUFFIXES,
} from "../db-url.js";
import type { SecretResolver } from "../resolver.js";

const PREFIX = "TESTDB";
const ALL_ENV_KEYS = [
  ...DB_URL_PART_SUFFIXES.map((s) => `${PREFIX}_${s}`),
  `${PREFIX}_URL`,
];

/** Preload the env-source resolver with the keys we care about. */
async function buildResolver(): Promise<SecretResolver> {
  const resolver = createSecretResolver({ schemes: { env: envSource() } });
  await resolver.preload(ALL_ENV_KEYS);
  return resolver;
}

describe("composeDbUrlFromResolver", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ALL_ENV_KEYS) {
      originalEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ALL_ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  describe("parts mode", () => {
    beforeEach(() => {
      process.env[`${PREFIX}_DIALECT`] = "postgres";
      process.env[`${PREFIX}_HOST`] = "db.example.com";
      process.env[`${PREFIX}_PORT`] = "5432";
      process.env[`${PREFIX}_USER`] = "alice";
      process.env[`${PREFIX}_PASSWORD`] = "s3cret";
      process.env[`${PREFIX}_DATABASE`] = "appdb";
    });

    it("composes a postgres URL from the six required parts", async () => {
      const resolver = await buildResolver();
      const { url, source } = composeDbUrlFromResolver({ resolver, prefix: PREFIX });
      expect(source).toBe("parts");
      expect(url).toBe("postgres://alice:s3cret@db.example.com:5432/appdb");
    });

    it("composes a mysql URL when DIALECT=mysql", async () => {
      process.env[`${PREFIX}_DIALECT`] = "mysql";
      const resolver = await buildResolver();
      const { url } = composeDbUrlFromResolver({ resolver, prefix: PREFIX });
      expect(url.startsWith("mysql://")).toBe(true);
    });

    it.each([
      { ch: "@", pwd: "p@ss", expected: "p%40ss" },
      { ch: ":", pwd: "p:ss", expected: "p%3Ass" },
      { ch: "/", pwd: "p/ss", expected: "p%2Fss" },
      { ch: "?", pwd: "p?ss", expected: "p%3Fss" },
      { ch: "#", pwd: "p#ss", expected: "p%23ss" },
    ])("URL-encodes $ch in the password", async ({ pwd, expected }) => {
      process.env[`${PREFIX}_PASSWORD`] = pwd;
      const resolver = await buildResolver();
      const { url } = composeDbUrlFromResolver({ resolver, prefix: PREFIX });
      // Pick out the password segment between `:` and `@`.
      const passwordSegment = url.match(/\/\/[^:]+:([^@]+)@/)?.[1];
      expect(passwordSegment).toBe(expected);
    });

    it("URL-encodes the user and database too", async () => {
      process.env[`${PREFIX}_USER`] = "ali ce";
      process.env[`${PREFIX}_DATABASE`] = "my/db";
      const resolver = await buildResolver();
      const { url } = composeDbUrlFromResolver({ resolver, prefix: PREFIX });
      expect(url).toContain("ali%20ce");
      expect(url).toContain("/my%2Fdb");
    });

    it("appends PARAMS verbatim when set without leading ?", async () => {
      process.env[`${PREFIX}_PARAMS`] = "sslmode=require&application_name=foo";
      const resolver = await buildResolver();
      const { url } = composeDbUrlFromResolver({ resolver, prefix: PREFIX });
      expect(url.endsWith("?sslmode=require&application_name=foo")).toBe(true);
    });

    it("trims a leading ? from PARAMS", async () => {
      process.env[`${PREFIX}_PARAMS`] = "?sslmode=require";
      const resolver = await buildResolver();
      const { url } = composeDbUrlFromResolver({ resolver, prefix: PREFIX });
      expect(url.endsWith("?sslmode=require")).toBe(true);
      expect(url).not.toContain("??");
    });

    it.each([
      { label: "empty string", value: "" },
      { label: "whitespace only", value: "   " },
      { label: "lone ?", value: "?" },
      { label: "? plus whitespace", value: "?  " },
    ])("omits the ? when PARAMS is $label", async ({ value }) => {
      process.env[`${PREFIX}_PARAMS`] = value;
      const resolver = await buildResolver();
      const { url } = composeDbUrlFromResolver({ resolver, prefix: PREFIX });
      expect(url.includes("?")).toBe(false);
    });

    it("warns when both parts and URL are set, and uses parts", async () => {
      process.env[`${PREFIX}_URL`] = "postgres://ignored:ignored@old:1/old";
      const warn = vi.fn();
      const resolver = await buildResolver();
      const { url, source } = composeDbUrlFromResolver({
        resolver,
        prefix: PREFIX,
        warn,
      });
      expect(source).toBe("parts");
      expect(url).toBe("postgres://alice:s3cret@db.example.com:5432/appdb");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain(PREFIX);
    });
  });

  describe("fallback to URL", () => {
    it.each(["DIALECT", "HOST", "PORT", "USER", "PASSWORD", "DATABASE"] as const)(
      "falls back to <P>_URL when %s is missing",
      async (missing) => {
        process.env[`${PREFIX}_DIALECT`] = "postgres";
        process.env[`${PREFIX}_HOST`] = "db.example.com";
        process.env[`${PREFIX}_PORT`] = "5432";
        process.env[`${PREFIX}_USER`] = "alice";
        process.env[`${PREFIX}_PASSWORD`] = "s3cret";
        process.env[`${PREFIX}_DATABASE`] = "appdb";
        delete process.env[`${PREFIX}_${missing}`];
        process.env[`${PREFIX}_URL`] =
          "postgres://fallback:fb@fallback-host:5432/fb";

        const resolver = await buildResolver();
        const { url, source } = composeDbUrlFromResolver({ resolver, prefix: PREFIX });
        expect(source).toBe("url");
        expect(url).toBe("postgres://fallback:fb@fallback-host:5432/fb");
      },
    );

    it("uses URL when only URL is set", async () => {
      process.env[`${PREFIX}_URL`] = "postgres://u:p@h:5432/d";
      const resolver = await buildResolver();
      const { url, source } = composeDbUrlFromResolver({ resolver, prefix: PREFIX });
      expect(source).toBe("url");
      expect(url).toBe("postgres://u:p@h:5432/d");
    });
  });

  describe("nothing configured", () => {
    it("throws a message naming both forms", async () => {
      const resolver = await buildResolver();
      expect(() => composeDbUrlFromResolver({ resolver, prefix: PREFIX })).toThrow(
        /TESTDB_URL.*TESTDB_\{DIALECT,HOST,PORT,USER,PASSWORD,DATABASE\}/,
      );
    });
  });
});
