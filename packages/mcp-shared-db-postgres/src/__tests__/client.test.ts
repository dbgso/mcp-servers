/**
 * `createPgClient` tests. We intercept the dynamic `import("pg")` via
 * `vi.mock` so the test never reaches the real `pg` package.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPgClient } from "../client.js";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("pg");
});

describe("createPgClient", () => {
  it("constructs a Client via the default export", async () => {
    const ctorSpy = vi.fn();
    class FakeClient {
      constructor(public cfg: { connectionString: string }) {
        ctorSpy(cfg);
      }
      async connect(): Promise<void> {}
      async query(): Promise<{ rows: [] }> {
        return { rows: [] };
      }
      async end(): Promise<void> {}
    }
    vi.doMock("pg", () => ({
      default: { Client: FakeClient },
    }));

    const client = await createPgClient("postgres://example");
    expect(client).toBeInstanceOf(FakeClient);
    expect(ctorSpy).toHaveBeenCalledWith({ connectionString: "postgres://example" });
  });

  it("falls back to a named Client export when default has no Client", async () => {
    class NamedClient {
      constructor(public cfg: { connectionString: string }) {}
      async connect(): Promise<void> {}
      async query(): Promise<{ rows: [] }> {
        return { rows: [] };
      }
      async end(): Promise<void> {}
    }
    // Vitest 4 synthesises a `default` export for ESM-style mocks; we still
    // hand it back an empty object so `mod.default?.Client` is undefined and
    // the named-export fallback kicks in.
    vi.doMock("pg", () => ({
      default: {},
      Client: NamedClient,
    }));

    const client = await createPgClient("postgres://example");
    expect(client).toBeInstanceOf(NamedClient);
  });

  it("throws a clear error when the pg module exposes no Client", async () => {
    // Declare the export keys so Vitest 4's strict ESM-mock validation
    // doesn't warn, but leave the values undefined so neither lookup
    // succeeds in `createPgClient`.
    vi.doMock("pg", () => ({ default: { Client: undefined }, Client: undefined }));
    await expect(createPgClient("postgres://example")).rejects.toThrow(
      /pg\.Client is not available/,
    );
  });
});
