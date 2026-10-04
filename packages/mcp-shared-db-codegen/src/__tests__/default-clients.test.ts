/**
 * The connections the introspector opens when nobody injects a client.
 *
 * Codegen used to carry its own copy of the mysql2 / pg connection setup,
 * and the mysql copy had drifted: it understood only `?ssl=true`, so a URL
 * asking for TLS with `?ssl-mode=REQUIRED` (or `sslmode=require`) connected
 * in plain text. The default factories are now the shared clients from
 * `mcp-shared-db-mysql` / `mcp-shared-db-postgres` (tested there); this
 * file pins that `pickIntrospector` really goes through them. The driver
 * module is swapped for a stub, so nothing connects to a database.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("mysql2/promise");
  vi.resetModules();
});

/** Run `pickIntrospector` against a stubbed mysql2 driver. */
async function pickWithMysqlDriver(url: string) {
  const createConnection = vi.fn(async () => ({
    query: async () => [[], []] as [unknown, unknown],
    end: async () => {},
    on: () => {},
  }));
  vi.resetModules();
  vi.doMock("mysql2/promise", () => ({ createConnection }));
  const { pickIntrospector } = await import("../introspect/pick.js");
  await pickIntrospector({ url });
  return createConnection;
}

describe("pickIntrospector default mysql connection", () => {
  it.each([
    "mysql://app@db.example.com/appdb?ssl-mode=REQUIRED",
    "mysql://app@db.example.com/appdb?sslmode=require",
  ])("enables TLS for %s", async (url) => {
    const createConnection = await pickWithMysqlDriver(url);

    expect(createConnection.mock.calls[0]?.[0]).toMatchObject({ ssl: {} });
  });

  it("forces multipleStatements off and keeps DATETIME values as Dates", async () => {
    const createConnection = await pickWithMysqlDriver(
      "mysql://app@db.example.com/appdb?multipleStatements=true",
    );

    expect(createConnection.mock.calls[0]?.[0]).toMatchObject({
      multipleStatements: false,
      dateStrings: false,
    });
  });
});
