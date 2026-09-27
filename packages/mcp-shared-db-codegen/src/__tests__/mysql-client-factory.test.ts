/**
 * The mysql2 connection the introspector opens when nobody injects a client.
 *
 * The postgres side of this has been tested since it was written; the mysql
 * side had not, and it is the same shape: a URL taken apart into driver
 * options, a dynamic import that may resolve two different ways, and an
 * adapter from the driver's `[rows, fields]` to the `{ rows }` the
 * introspector expects. Nothing here connects to a database -- the driver
 * module is swapped for a stub, which is what the missing-export branch is
 * about in the first place.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { wrapConnectionForIntrospect } from "../introspect/mysql.js";

afterEach(() => {
  vi.doUnmock("mysql2/promise");
  vi.resetModules();
});

/** Load `createMysqlClient` against a stubbed driver module. */
async function withDriver(mod: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock("mysql2/promise", () => mod);
  const { createMysqlClient } = await import("../introspect/mysql.js");
  return createMysqlClient;
}

describe("createMysqlClient", () => {
  it("takes the URL apart into driver options", async () => {
    const createConnection = vi.fn(async () => ({
      query: async () => [[], []] as [unknown, unknown],
      end: async () => {},
    }));
    const createMysqlClient = await withDriver({ createConnection });

    await createMysqlClient("mysql://app:s3cret@db.example.com:3307/appdb?ssl=true");

    expect(createConnection).toHaveBeenCalledWith({
      multipleStatements: false,
      host: "db.example.com",
      port: 3307,
      user: "app",
      password: "s3cret",
      database: "appdb",
      ssl: {},
    });
  });

  it("leaves out every part the URL does not carry", async () => {
    // `mysql:///` is a socket connection with the driver's own defaults. An
    // explicit `host: ""` or `port: NaN` is not the same thing.
    const createConnection = vi.fn(async () => ({
      query: async () => [[], []] as [unknown, unknown],
      end: async () => {},
    }));
    const createMysqlClient = await withDriver({ createConnection });

    await createMysqlClient("mysql:///");

    expect(createConnection).toHaveBeenCalledWith({ multipleStatements: false });
  });

  it("keeps a credential that is not valid percent-encoding", async () => {
    const createConnection = vi.fn(async () => ({
      query: async () => [[], []] as [unknown, unknown],
      end: async () => {},
    }));
    const createMysqlClient = await withDriver({ createConnection });

    await createMysqlClient("mysql://user:pa%zzss@h/db");

    expect(createConnection.mock.calls[0]?.[0]).toMatchObject({ password: "pa%zzss" });
  });

  it("finds the factory behind a default export", async () => {
    // Whether `mysql2/promise` reaches an ESM importer as named exports or
    // behind `default` depends on the interop, and it has changed between
    // releases of both the driver and the bundlers around it.
    const createConnection = vi.fn(async () => ({
      query: async () => [[], []] as [unknown, unknown],
      end: async () => {},
    }));
    // `createConnection: undefined` alongside the default export keeps
    // vitest's mock validator happy while leaving the named export absent.
    const createMysqlClient = await withDriver({
      default: { createConnection },
      createConnection: undefined,
    });

    const client = await createMysqlClient("mysql://h/db");

    expect(createConnection).toHaveBeenCalledTimes(1);
    expect(typeof client.query).toBe("function");
  });

  it("says the driver is missing rather than failing on undefined", async () => {
    const createMysqlClient = await withDriver({
      default: { createConnection: undefined },
      createConnection: undefined,
    });

    await expect(createMysqlClient("mysql://h/db")).rejects.toThrow(/mysql2/);
  });
});

describe("the adapter around a driver connection", () => {
  it("returns the rows and drops the field metadata", async () => {
    const conn = {
      query: vi.fn(async () => [[{ a: 1 }], [{ name: "a" }]] as [unknown, unknown]),
      end: vi.fn(async () => {}),
    };
    const client = wrapConnectionForIntrospect(conn);

    await client.connect();
    const result = await client.query({ text: "select 1", values: [7] });

    expect(result.rows).toEqual([{ a: 1 }]);
    expect(conn.query).toHaveBeenCalledWith("select 1", [7]);
  });

  it("passes an empty parameter list when the query has none", async () => {
    const conn = {
      query: vi.fn(async () => [[], []] as [unknown, unknown]),
      end: vi.fn(async () => {}),
    };
    const client = wrapConnectionForIntrospect(conn);

    await client.query({ text: "select 1" });

    expect(conn.query).toHaveBeenCalledWith("select 1", []);
  });

  it("reports no rows when the driver answers with something that is not a list", async () => {
    // A statement with no result set -- mysql2 hands back an OkPacket object
    // rather than an array, and reading it as rows would put the packet's own
    // fields into the introspection result.
    const conn = {
      query: vi.fn(async () => [{ affectedRows: 0 }, []] as [unknown, unknown]),
      end: vi.fn(async () => {}),
    };
    const client = wrapConnectionForIntrospect(conn);

    expect((await client.query({ text: "set names utf8" })).rows).toEqual([]);
  });

  it("closes the driver connection", async () => {
    const conn = {
      query: vi.fn(async () => [[], []] as [unknown, unknown]),
      end: vi.fn(async () => {}),
    };
    const client = wrapConnectionForIntrospect(conn);

    await client.end();

    expect(conn.end).toHaveBeenCalledTimes(1);
  });
});
