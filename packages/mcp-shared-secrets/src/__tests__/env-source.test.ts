import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { envSource } from "../env-source.js";

const KEYS = ["ENV_SOURCE_TARGET", "ENV_SOURCE_OTHER"];

describe("envSource", () => {
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = {};
    for (const k of KEYS) {
      original[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it("returns the value of the referenced env var", async () => {
    process.env.ENV_SOURCE_TARGET = "hello";
    const src = envSource();
    await expect(src.fetch("ENV_SOURCE_TARGET")).resolves.toBe("hello");
  });

  it("returns undefined when the referenced env var is unset", async () => {
    const src = envSource();
    await expect(src.fetch("ENV_SOURCE_TARGET")).resolves.toBeUndefined();
  });

  it("looks up exactly the path it is given (no implicit prefix)", async () => {
    process.env.ENV_SOURCE_OTHER = "other-value";
    const src = envSource();
    await expect(src.fetch("ENV_SOURCE_OTHER")).resolves.toBe("other-value");
    await expect(src.fetch("ENV_SOURCE_TARGET")).resolves.toBeUndefined();
  });
});
