import { describe, it, expect, vi } from "vitest";
import {
  PostgresIntrospector,
  POSTGRES_QUERIES,
  formatNativeType,
} from "../introspect/postgres.js";
import { mapPostgresType } from "../introspect/postgres-types.js";
import { createFakePgClient } from "./fixtures/pg-client.js";

describe("mapPostgresType", () => {
  it.each([
    ["text", "string"],
    ["varchar", "string"],
    ["varchar(255)", "string"],
    ["character varying", "string"],
    ["char(10)", "string"],
    ["uuid", "string"],
    ["citext", "string"],
    ["bpchar", "string"],
    ["int", "number"],
    ["int4", "number"],
    ["int8", "number"],
    ["bigint", "number"],
    ["numeric(10,2)", "number"],
    ["decimal", "number"],
    ["real", "number"],
    ["double precision", "number"],
    ["serial", "number"],
    ["bigserial", "number"],
    ["money", "number"],
    ["bool", "boolean"],
    ["boolean", "boolean"],
    ["timestamp", "datetime"],
    ["timestamp with time zone", "datetime"],
    ["timestamptz", "datetime"],
    ["date", "datetime"],
    ["time", "datetime"],
    ["timetz", "datetime"],
    ["json", "json"],
    ["jsonb", "json"],
    ["bytea", "binary"],
    ["unknown_custom_type", "string"], // fallback
  ])("maps %s -> %s", (native, expected) => {
    expect(mapPostgresType(native)).toBe(expected);
  });
});

describe("formatNativeType", () => {
  it("appends char_max_length to varchar/char", () => {
    expect(
      formatNativeType({ dataType: "character varying", udtName: "varchar", charMaxLength: 255 }),
    ).toBe("varchar(255)");
    expect(
      formatNativeType({ dataType: "character", udtName: "bpchar", charMaxLength: 10 }),
    ).toBe("bpchar(10)");
  });

  it("uses udtName when no length applies", () => {
    expect(
      formatNativeType({ dataType: "integer", udtName: "int4", charMaxLength: null }),
    ).toBe("int4");
  });

  it("falls back to dataType when udtName is null", () => {
    expect(
      formatNativeType({ dataType: "json", udtName: null, charMaxLength: null }),
    ).toBe("json");
  });

  it("ignores char_max_length on non-string types", () => {
    expect(
      formatNativeType({ dataType: "numeric", udtName: "numeric", charMaxLength: 10 }),
    ).toBe("numeric");
  });
});

describe("PostgresIntrospector.listSchemas", () => {
  it("issues the schemas query and returns schema names", async () => {
    const client = createFakePgClient({
      schemas: () => ({
        rows: [{ schema_name: "public" }, { schema_name: "app" }],
      }),
    });
    const introspector = new PostgresIntrospector(client);
    const schemas = await introspector.listSchemas();
    expect(schemas).toEqual(["public", "app"]);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.calls[0].sql).toBe(POSTGRES_QUERIES.schemas);
  });

  it("connects only once across multiple calls", async () => {
    const client = createFakePgClient({
      schemas: () => ({ rows: [{ schema_name: "public" }] }),
    });
    const introspector = new PostgresIntrospector(client);
    await introspector.listSchemas();
    await introspector.listSchemas();
    expect(client.connect).toHaveBeenCalledTimes(1);
  });
});

describe("PostgresIntrospector.listTables", () => {
  it("returns table info with description and row count", async () => {
    const client = createFakePgClient({
      tables: () => ({
        rows: [
          { name: "users", description: "App users", row_count: "1234" },
          { name: "orders", description: null, row_count: -1 },
          { name: "logs", description: null, row_count: null },
        ],
      }),
    });
    const introspector = new PostgresIntrospector(client);
    const tables = await introspector.listTables("public");
    expect(tables).toEqual([
      { schema: "public", name: "users", description: "App users", rowCount: 1234 },
      { schema: "public", name: "orders" },
      { schema: "public", name: "logs" },
    ]);
    expect(client.calls[0].values).toEqual(["public"]);
  });

  it("treats NaN row counts as undefined", async () => {
    const client = createFakePgClient({
      tables: () => ({ rows: [{ name: "t", description: null, row_count: "not-a-number" }] }),
    });
    const introspector = new PostgresIntrospector(client);
    const tables = await introspector.listTables("public");
    expect(tables[0].rowCount).toBeUndefined();
  });
});

describe("PostgresIntrospector.introspectTable", () => {
  function buildClient() {
    return createFakePgClient({
      tables: () => ({
        rows: [{ name: "users", description: "Application users", row_count: "100" }],
      }),
      columns: () => ({
        rows: [
          {
            name: "id",
            data_type: "integer",
            udt_name: "int4",
            char_max_length: null,
            is_nullable: "NO",
            column_default: "nextval('users_id_seq')",
            description: "Primary key",
          },
          {
            name: "email",
            data_type: "character varying",
            udt_name: "varchar",
            char_max_length: 255,
            is_nullable: "NO",
            column_default: null,
            description: null,
          },
          {
            name: "metadata",
            data_type: "jsonb",
            udt_name: "jsonb",
            char_max_length: null,
            is_nullable: "YES",
            column_default: null,
            description: null,
          },
        ],
      }),
      primaryKey: () => ({ rows: [{ column_name: "id" }] }),
      indexes: () => ({
        rows: [
          { index_name: "users_email_idx", column_name: "email", is_unique: true },
          // Composite index across two columns:
          { index_name: "users_compound", column_name: "email", is_unique: false },
          { index_name: "users_compound", column_name: "id", is_unique: false },
        ],
      }),
      foreignKeys: () => ({
        rows: [
          {
            field: "owner_id",
            ref_schema: "public",
            ref_table: "accounts",
            ref_field: "id",
          },
        ],
      }),
    });
  }

  it("returns a fully-populated RawTableMetadata", async () => {
    const client = buildClient();
    const introspector = new PostgresIntrospector(client);
    const meta = await introspector.introspectTable({ schema: "public", table: "users" });

    expect(meta.schema).toBe("public");
    expect(meta.name).toBe("users");
    expect(meta.description).toBe("Application users");
    expect(meta.primaryKey).toEqual(["id"]);
    expect(meta.columns).toHaveLength(3);

    const idCol = meta.columns[0];
    expect(idCol.name).toBe("id");
    expect(idCol.nativeType).toBe("int4");
    expect(idCol.type).toBe("number");
    expect(idCol.nullable).toBe(false);
    expect(idCol.default).toBe("nextval('users_id_seq')");
    expect(idCol.description).toBe("Primary key");

    const emailCol = meta.columns[1];
    expect(emailCol.nativeType).toBe("varchar(255)");
    expect(emailCol.type).toBe("string");
    expect(emailCol.description).toBeUndefined();

    const metaCol = meta.columns[2];
    expect(metaCol.nativeType).toBe("jsonb");
    expect(metaCol.type).toBe("json");
    expect(metaCol.nullable).toBe(true);

    expect(meta.indexes).toHaveLength(2);
    const compound = meta.indexes.find((i) => i.name === "users_compound");
    expect(compound?.fields).toEqual(["email", "id"]);
    expect(compound?.isUnique).toBe(false);

    expect(meta.foreignKeys).toEqual([
      {
        field: "owner_id",
        referencedSchema: "public",
        referencedTable: "accounts",
        referencedField: "id",
      },
    ]);
  });

  it("omits description when not in pg_class", async () => {
    const client = createFakePgClient({
      tables: () => ({ rows: [{ name: "users", description: null, row_count: null }] }),
      columns: () => ({ rows: [] }),
      primaryKey: () => ({ rows: [] }),
      indexes: () => ({ rows: [] }),
      foreignKeys: () => ({ rows: [] }),
    });
    const introspector = new PostgresIntrospector(client);
    const meta = await introspector.introspectTable({ schema: "public", table: "users" });
    expect(meta.description).toBeUndefined();
    expect(meta.primaryKey).toEqual([]);
    expect(meta.columns).toEqual([]);
  });

  it("handles a missing table row in tables result without crashing", async () => {
    const client = createFakePgClient({
      tables: () => ({ rows: [] }), // table not found in metadata listing
      columns: () => ({ rows: [] }),
      primaryKey: () => ({ rows: [] }),
      indexes: () => ({ rows: [] }),
      foreignKeys: () => ({ rows: [] }),
    });
    const introspector = new PostgresIntrospector(client);
    const meta = await introspector.introspectTable({ schema: "public", table: "ghost" });
    expect(meta.description).toBeUndefined();
  });
});

describe("createPgClient", () => {
  it("constructs a pg.Client without connecting", async () => {
    const { createPgClient } = await import("../introspect/postgres.js");
    const client = await createPgClient("postgres://user:pass@localhost:5432/db");
    // Real pg.Client exposes connect/query/end methods. Verify the shape
    // — we never call connect() so no socket is opened.
    expect(typeof client.connect).toBe("function");
    expect(typeof client.query).toBe("function");
    expect(typeof client.end).toBe("function");
  });

  it("throws when the loaded pg module exposes no Client constructor", async () => {
    // Use vi.doMock to swap the `pg` module before re-importing the source
    // under test. The dynamic import inside `createPgClient` resolves to
    // our stub, exercising the "missing Client" defensive branch.
    vi.resetModules();
    // Both default and module-level `Client` are explicitly undefined so
    // vitest's mock validator is happy and `createPgClient`'s defensive
    // branch ("ctor missing") is exercised.
    vi.doMock("pg", () => ({
      default: { Client: undefined },
      Client: undefined,
    }));
    const { createPgClient } = await import("../introspect/postgres.js");
    await expect(createPgClient("postgres://h:5432/d")).rejects.toThrow(
      /pg\.Client is not available/,
    );
    vi.doUnmock("pg");
    vi.resetModules();
  });
});

describe("PostgresIntrospector.close", () => {
  it("ends the client when previously connected", async () => {
    const client = createFakePgClient({
      schemas: () => ({ rows: [] }),
    });
    const introspector = new PostgresIntrospector(client);
    await introspector.listSchemas();
    await introspector.close();
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when never connected", async () => {
    const client = createFakePgClient({});
    const introspector = new PostgresIntrospector(client);
    await introspector.close();
    expect(client.end).not.toHaveBeenCalled();
  });

  it("is idempotent", async () => {
    const client = createFakePgClient({ schemas: () => ({ rows: [] }) });
    const introspector = new PostgresIntrospector(client);
    await introspector.listSchemas();
    await introspector.close();
    await introspector.close();
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});
