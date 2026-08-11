import { describe, expect, it } from "vitest";
import {
  MysqlIntrospector,
  MYSQL_QUERIES,
} from "../introspect/mysql.js";
import { mapMysqlType } from "../introspect/mysql-types.js";
import { createFakeMysqlClient } from "./fixtures/mysql-client.js";

describe("mapMysqlType", () => {
  it.each([
    ["tinyint(1)", "boolean"],
    ["TINYINT(1)", "boolean"],
    ["tinyint( 1 )", "boolean"],
    ["bool", "boolean"],
    ["boolean", "boolean"],
    ["tinyint(4)", "number"],
    ["int", "number"],
    ["int(11)", "number"],
    ["int(10) unsigned", "number"],
    ["bigint", "number"],
    ["bigint unsigned", "number"],
    ["smallint", "number"],
    ["mediumint", "number"],
    ["decimal(10,2)", "number"],
    ["numeric(8)", "number"],
    ["float", "number"],
    ["double", "number"],
    ["bit(8)", "number"],
    ["char(10)", "string"],
    ["varchar(255)", "string"],
    ["text", "string"],
    ["tinytext", "string"],
    ["mediumtext", "string"],
    ["longtext", "string"],
    ["enum('a','b')", "string"],
    ["set('a','b')", "string"],
    ["uuid", "string"],
    ["date", "datetime"],
    ["datetime", "datetime"],
    ["datetime(6)", "datetime"],
    ["timestamp", "datetime"],
    ["time", "datetime"],
    ["year", "datetime"],
    ["json", "json"],
    ["binary(16)", "binary"],
    ["varbinary(255)", "binary"],
    ["blob", "binary"],
    ["mediumblob", "binary"],
    ["longblob", "binary"],
    ["unknown_custom_type", "string"], // fallback
  ])("maps %s -> %s", (native, expected) => {
    expect(mapMysqlType(native)).toBe(expected);
  });
});

describe("MysqlIntrospector.listSchemas", () => {
  it("issues the schemas query and returns schema names", async () => {
    const client = createFakeMysqlClient({
      schemas: () => ({
        rows: [{ schema_name: "appdb" }, { schema_name: "reports" }],
      }),
    });
    const introspector = new MysqlIntrospector(client);
    const schemas = await introspector.listSchemas();
    expect(schemas).toEqual(["appdb", "reports"]);
    expect(client.calls[0]?.sql).toBe(MYSQL_QUERIES.schemas);
  });

  it("connects lazily on first query and reuses the connection", async () => {
    const client = createFakeMysqlClient({
      schemas: () => ({ rows: [] }),
    });
    const introspector = new MysqlIntrospector(client);
    await introspector.listSchemas();
    await introspector.listSchemas();
    expect(client.connect).toHaveBeenCalledTimes(1);
  });
});

describe("MysqlIntrospector.listTables", () => {
  it("returns name/description/rowCount and elides empty/null fields", async () => {
    const client = createFakeMysqlClient({
      tables: () => ({
        rows: [
          { name: "users", description: "core user records", row_count: 1234 },
          { name: "orders", description: "", row_count: 0 },
          { name: "events", description: null, row_count: null },
        ],
      }),
    });
    const introspector = new MysqlIntrospector(client);
    const tables = await introspector.listTables("appdb");
    expect(tables).toEqual([
      {
        schema: "appdb",
        name: "users",
        description: "core user records",
        rowCount: 1234,
      },
      { schema: "appdb", name: "orders", rowCount: 0 },
      { schema: "appdb", name: "events" },
    ]);
    expect(client.calls[0]?.values).toEqual(["appdb"]);
  });

  it("treats negative row_count (driver oddity) as unknown", async () => {
    const client = createFakeMysqlClient({
      tables: () => ({
        rows: [{ name: "t", description: null, row_count: -1 }],
      }),
    });
    const introspector = new MysqlIntrospector(client);
    const tables = await introspector.listTables("appdb");
    expect(tables[0].rowCount).toBeUndefined();
  });

  it("parses string row_count (some drivers stringify large bigints)", async () => {
    const client = createFakeMysqlClient({
      tables: () => ({
        rows: [{ name: "t", description: null, row_count: "98765" }],
      }),
    });
    const introspector = new MysqlIntrospector(client);
    const tables = await introspector.listTables("appdb");
    expect(tables[0].rowCount).toBe(98765);
  });

  it("treats unparseable string row_count as unknown", async () => {
    const client = createFakeMysqlClient({
      tables: () => ({
        rows: [{ name: "t", description: null, row_count: "n/a" }],
      }),
    });
    const introspector = new MysqlIntrospector(client);
    const tables = await introspector.listTables("appdb");
    expect(tables[0].rowCount).toBeUndefined();
  });
});

describe("MysqlIntrospector.introspectTable", () => {
  it("aggregates columns / pk / indexes / fks for a table", async () => {
    const client = createFakeMysqlClient({
      tables: () => ({
        rows: [{ name: "users", description: "user records", row_count: 100 }],
      }),
      columns: () => ({
        rows: [
          {
            name: "id",
            data_type: "char",
            column_type: "char(36)",
            char_max_length: 36,
            is_nullable: "NO",
            column_default: null,
            description: "primary key",
          },
          {
            name: "is_active",
            data_type: "tinyint",
            column_type: "tinyint(1)",
            char_max_length: null,
            is_nullable: "NO",
            column_default: "1",
            description: null,
          },
          {
            name: "meta",
            data_type: "json",
            column_type: "json",
            char_max_length: null,
            is_nullable: "YES",
            column_default: null,
            description: "",
          },
        ],
      }),
      primaryKey: () => ({ rows: [{ column_name: "id" }] }),
      indexes: () => ({
        rows: [
          { index_name: "ux_users_email", column_name: "email", is_unique: 1, pos: 1 },
          { index_name: "ix_active_meta", column_name: "is_active", is_unique: 0, pos: 1 },
          { index_name: "ix_active_meta", column_name: "meta", is_unique: 0, pos: 2 },
        ],
      }),
      foreignKeys: () => ({
        rows: [
          {
            field: "org_id",
            ref_schema: "appdb",
            ref_table: "orgs",
            ref_field: "id",
          },
        ],
      }),
    });
    const introspector = new MysqlIntrospector(client);
    const meta = await introspector.introspectTable({
      schema: "appdb",
      table: "users",
    });
    expect(meta.schema).toBe("appdb");
    expect(meta.name).toBe("users");
    expect(meta.description).toBe("user records");
    expect(meta.primaryKey).toEqual(["id"]);
    expect(meta.columns).toEqual([
      {
        name: "id",
        nativeType: "char(36)",
        type: "string",
        nullable: false,
        description: "primary key",
      },
      {
        name: "is_active",
        nativeType: "tinyint(1)",
        type: "boolean",
        nullable: false,
        default: "1",
      },
      {
        name: "meta",
        nativeType: "json",
        type: "json",
        nullable: true,
      },
    ]);
    expect(meta.indexes).toEqual([
      { name: "ux_users_email", fields: ["email"], isUnique: true },
      { name: "ix_active_meta", fields: ["is_active", "meta"], isUnique: false },
    ]);
    expect(meta.foreignKeys).toEqual([
      {
        field: "org_id",
        referencedSchema: "appdb",
        referencedTable: "orgs",
        referencedField: "id",
      },
    ]);
  });

  it("handles boolean is_unique surfaced by drivers that auto-cast 0/1", async () => {
    const client = createFakeMysqlClient({
      tables: () => ({ rows: [] }),
      columns: () => ({ rows: [] }),
      primaryKey: () => ({ rows: [] }),
      indexes: () => ({
        rows: [
          { index_name: "ux", column_name: "a", is_unique: true, pos: 1 },
          { index_name: "ix", column_name: "b", is_unique: false, pos: 1 },
        ],
      }),
      foreignKeys: () => ({ rows: [] }),
    });
    const introspector = new MysqlIntrospector(client);
    const meta = await introspector.introspectTable({
      schema: "appdb",
      table: "users",
    });
    expect(meta.indexes).toEqual([
      { name: "ux", fields: ["a"], isUnique: true },
      { name: "ix", fields: ["b"], isUnique: false },
    ]);
  });

  it("issues queries with bound (schema, table) values", async () => {
    const client = createFakeMysqlClient({
      tables: () => ({ rows: [] }),
      columns: () => ({ rows: [] }),
      primaryKey: () => ({ rows: [] }),
      indexes: () => ({ rows: [] }),
      foreignKeys: () => ({ rows: [] }),
    });
    const introspector = new MysqlIntrospector(client);
    await introspector.introspectTable({ schema: "appdb", table: "users" });
    const valuesByQuery = client.calls.map((c) => c.values);
    // tables query takes [schema], everything else takes [schema, table].
    expect(valuesByQuery[0]).toEqual(["appdb"]);
    for (const v of valuesByQuery.slice(1)) {
      expect(v).toEqual(["appdb", "users"]);
    }
  });

  it("falls back to undefined description when the table comment is empty", async () => {
    const client = createFakeMysqlClient({
      tables: () => ({
        rows: [{ name: "users", description: "", row_count: 1 }],
      }),
      columns: () => ({ rows: [] }),
      primaryKey: () => ({ rows: [] }),
      indexes: () => ({ rows: [] }),
      foreignKeys: () => ({ rows: [] }),
    });
    const introspector = new MysqlIntrospector(client);
    const meta = await introspector.introspectTable({
      schema: "appdb",
      table: "users",
    });
    expect(meta.description).toBeUndefined();
  });
});

describe("MysqlIntrospector.close", () => {
  it("closes the underlying connection only when one was opened", async () => {
    const client = createFakeMysqlClient({});
    const introspector = new MysqlIntrospector(client);
    // No queries issued — close is a no-op.
    await introspector.close();
    expect(client.end).not.toHaveBeenCalled();
  });

  it("closes after at least one query has been issued", async () => {
    const client = createFakeMysqlClient({
      schemas: () => ({ rows: [] }),
    });
    const introspector = new MysqlIntrospector(client);
    await introspector.listSchemas();
    await introspector.close();
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});
