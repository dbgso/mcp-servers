import { describe, it, expect } from "vitest";
import { pickIntrospector } from "../introspect/pick.js";
import { PostgresIntrospector } from "../introspect/postgres.js";
import { MysqlIntrospector } from "../introspect/mysql.js";
import { createFakePgClient } from "./fixtures/pg-client.js";
import { createFakeMysqlClient } from "./fixtures/mysql-client.js";

describe("pickIntrospector", () => {
  it("returns a PostgresIntrospector for postgres:// URLs", async () => {
    const introspector = await pickIntrospector({
      url: "postgres://u:p@h:5432/d",
      pgClientFactory: async () => createFakePgClient({}),
    });
    expect(introspector).toBeInstanceOf(PostgresIntrospector);
  });

  it("accepts the postgresql:// alias", async () => {
    const introspector = await pickIntrospector({
      url: "postgresql://u@h:5432/d",
      pgClientFactory: async () => createFakePgClient({}),
    });
    expect(introspector).toBeInstanceOf(PostgresIntrospector);
  });

  it("returns a MysqlIntrospector for mysql:// URLs", async () => {
    const introspector = await pickIntrospector({
      url: "mysql://u:p@h:3306/d",
      mysqlClientFactory: async () => createFakeMysqlClient({}),
    });
    expect(introspector).toBeInstanceOf(MysqlIntrospector);
  });

  it("treats the scheme match case-insensitively (MYSQL://)", async () => {
    const introspector = await pickIntrospector({
      url: "MYSQL://u@h:3306/d",
      mysqlClientFactory: async () => createFakeMysqlClient({}),
    });
    expect(introspector).toBeInstanceOf(MysqlIntrospector);
  });

  it("throws on unsupported schemes", async () => {
    await expect(pickIntrospector({ url: "mongodb://h/d" })).rejects.toThrow(
      /Unsupported scheme/,
    );
    await expect(pickIntrospector({ url: "redis://h" })).rejects.toThrow(
      /Unsupported scheme/,
    );
  });

  it("uses the default createPgClient when no factory is given", async () => {
    // Confirms the `?? createPgClient` fallback by exercising the path
    // with only a url. The default factory builds a real (un-connected)
    // pg.Client, which never opens a socket since we don't call connect().
    const introspector = await pickIntrospector({
      url: "postgres://u@localhost:5432/d",
    });
    expect(introspector).toBeInstanceOf(PostgresIntrospector);
  });
});
