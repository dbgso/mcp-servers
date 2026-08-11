/**
 * `createMysqlClient` / `urlToConnectionOptions` tests. The dynamic
 * `import("mysql2/promise")` is intercepted via `vi.mock` so the test never
 * reaches the real driver.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMysqlClient,
  urlToConnectionOptions,
  wrapConnection,
  type MysqlConnectionOptions,
} from "../client.js";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("mysql2/promise");
});

describe("urlToConnectionOptions", () => {
  it("parses host / port / user / password / database from a typical URL", () => {
    const opts = urlToConnectionOptions(
      "mysql://app:secret@db.example.com:3307/appdb",
    );
    expect(opts).toMatchObject({
      host: "db.example.com",
      port: 3307,
      user: "app",
      password: "secret",
      database: "appdb",
      multipleStatements: false,
      dateStrings: false,
    });
  });

  it("decodes percent-encoded credentials", () => {
    const opts = urlToConnectionOptions(
      "mysql://us%40er:p%40ss@h/db",
    );
    expect(opts.user).toBe("us@er");
    expect(opts.password).toBe("p@ss");
  });

  it("forces multipleStatements:false even when the URL asks for true", () => {
    // Lock the load-bearing defence: mysql2 disables multi-statement at the
    // wire by default, but a URL like `?multipleStatements=true` would flip
    // it on. The factory must override.
    const opts = urlToConnectionOptions(
      "mysql://h/db?multipleStatements=true",
    );
    expect(opts.multipleStatements).toBe(false);
  });

  it("translates ?ssl=true into the option-object ssl:{} form", () => {
    const opts = urlToConnectionOptions("mysql://h/db?ssl=true");
    expect(opts.ssl).toEqual({});
  });

  it.each(["required", "REQUIRED", "verify-ca", "verify-identity", "require"])(
    "translates ?ssl-mode=%s into ssl:{}",
    (mode) => {
      const opts = urlToConnectionOptions(`mysql://h/db?ssl-mode=${mode}`);
      expect(opts.ssl).toEqual({});
    },
  );

  it("treats sslmode (no hyphen) like ssl-mode for forgiveness", () => {
    const opts = urlToConnectionOptions("mysql://h/db?sslmode=required");
    expect(opts.ssl).toEqual({});
  });

  it.each(["disabled", "preferred", "PREFERRED"])(
    "leaves ssl unset for non-strict modes (%s)",
    (mode) => {
      const opts = urlToConnectionOptions(`mysql://h/db?ssl-mode=${mode}`);
      expect(opts.ssl).toBeUndefined();
    },
  );

  it("leaves database undefined when the URL has no path", () => {
    const opts = urlToConnectionOptions("mysql://h:3306");
    expect(opts.database).toBeUndefined();
  });
});

describe("createMysqlClient", () => {
  it("constructs a connection via the named export", async () => {
    const ctorSpy = vi.fn();
    const fakeConn = {
      async query() {
        return [[], []];
      },
      async end() {},
      on() {},
    };
    vi.doMock("mysql2/promise", () => ({
      createConnection: async (opts: MysqlConnectionOptions) => {
        ctorSpy(opts);
        return fakeConn;
      },
    }));

    const client = await createMysqlClient(
      "mysql://app:secret@db.example.com:3306/appdb",
    );
    expect(client).toBeDefined();
    expect(ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "db.example.com",
        port: 3306,
        user: "app",
        password: "secret",
        database: "appdb",
        multipleStatements: false,
      }),
    );
  });

  it("falls back to a default-export createConnection", async () => {
    const ctorSpy = vi.fn();
    const fakeConn = {
      async query() {
        return [[], []];
      },
      async end() {},
      on() {},
    };
    // Vitest 4's ESM-mock validation requires every accessed key to be
    // declared at the module surface, even if it's `undefined`. Hand back an
    // explicit `createConnection: undefined` so the named-lookup falls
    // through to the default-export branch.
    vi.doMock("mysql2/promise", () => ({
      createConnection: undefined,
      default: {
        createConnection: async (opts: MysqlConnectionOptions) => {
          ctorSpy(opts);
          return fakeConn;
        },
      },
    }));
    const client = await createMysqlClient("mysql://h/db");
    expect(client).toBeDefined();
    expect(ctorSpy).toHaveBeenCalled();
  });

  it("throws a clear error when the mysql2 module exposes no createConnection", async () => {
    vi.doMock("mysql2/promise", () => ({
      default: { createConnection: undefined },
      createConnection: undefined,
    }));
    await expect(createMysqlClient("mysql://h/db")).rejects.toThrow(
      /mysql2\/promise\.createConnection is not available/,
    );
  });

  it("connection-time options always include multipleStatements:false (regression lock)", async () => {
    // If a future "convenience PR" lets the URL pass `?multipleStatements=
    // true` through, the option still has to come out false at the driver
    // boundary. Capture the actual options handed to mysql2.
    let captured: MysqlConnectionOptions | null = null;
    vi.doMock("mysql2/promise", () => ({
      createConnection: async (opts: MysqlConnectionOptions) => {
        captured = opts;
        return {
          async query() {
            return [[], []];
          },
          async end() {},
          on() {},
        };
      },
    }));
    await createMysqlClient("mysql://h/db?multipleStatements=true");
    expect(captured).not.toBeNull();
    expect(captured!.multipleStatements).toBe(false);
  });
});

describe("wrapConnection", () => {
  it("connect() is a no-op (mysql2 connection is already active)", async () => {
    const client = wrapConnection({
      async query() {
        return [[], []];
      },
      async end() {},
      on() {},
    });
    await expect(client.connect()).resolves.toBeUndefined();
  });

  it("query() unwraps mysql2's [rows, fields] tuple into { rows }", async () => {
    const client = wrapConnection({
      async query() {
        return [[{ id: 1 }, { id: 2 }], []];
      },
      async end() {},
      on() {},
    });
    const result = await client.query({ text: "SELECT id FROM t" });
    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("query() returns rows: [] for non-SELECT (OkPacket-style) responses", async () => {
    const client = wrapConnection({
      async query() {
        // SET / DDL: mysql2 returns an OkPacket object, not an array.
        return [{ affectedRows: 0 } as unknown as never[], []];
      },
      async end() {},
      on() {},
    });
    const result = await client.query({ text: "SET SESSION x = 1" });
    expect(result.rows).toEqual([]);
  });

  it("query() forwards values to the driver", async () => {
    let capturedSql = "";
    let capturedValues: unknown[] | undefined;
    const client = wrapConnection({
      async query(sql, values) {
        capturedSql = sql;
        capturedValues = values;
        return [[], []];
      },
      async end() {},
      on() {},
    });
    await client.query({
      text: "SELECT * FROM t WHERE id = ?",
      values: [42],
    });
    expect(capturedSql).toBe("SELECT * FROM t WHERE id = ?");
    expect(capturedValues).toEqual([42]);
  });

  it("query() defaults values to an empty array when omitted", async () => {
    let capturedValues: unknown[] | undefined;
    const client = wrapConnection({
      async query(_sql, values) {
        capturedValues = values;
        return [[], []];
      },
      async end() {},
      on() {},
    });
    await client.query({ text: "SELECT 1" });
    expect(capturedValues).toEqual([]);
  });

  it("end() forwards to the underlying connection", async () => {
    const endSpy = vi.fn(async () => {});
    const client = wrapConnection({
      async query() {
        return [[], []];
      },
      end: endSpy,
      on() {},
    });
    await client.end();
    expect(endSpy).toHaveBeenCalled();
  });

  it("onError() subscribes to the connection's 'error' channel", () => {
    const onSpy = vi.fn();
    const client = wrapConnection({
      async query() {
        return [[], []];
      },
      async end() {},
      on: onSpy,
    });
    const listener = (): void => {};
    client.onError(listener);
    expect(onSpy).toHaveBeenCalledWith("error", listener);
  });
});
