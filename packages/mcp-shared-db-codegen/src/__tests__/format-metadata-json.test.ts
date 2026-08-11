import { describe, it, expect } from "vitest";
import { formatMetadataJson } from "../format/metadata-json.js";
import type { RawTableMetadata } from "../introspect/types.js";

const usersTable: RawTableMetadata = {
  schema: "public",
  name: "users",
  description: "Application users",
  primaryKey: ["id"],
  columns: [
    { name: "id", nativeType: "int4", type: "number", nullable: false },
    {
      name: "email",
      nativeType: "varchar(255)",
      type: "string",
      nullable: false,
      description: "Login email",
    },
    { name: "metadata", nativeType: "jsonb", type: "json", nullable: true },
  ],
  indexes: [{ name: "users_email_idx", fields: ["email"], isUnique: true }],
  foreignKeys: [],
};

const ordersTable: RawTableMetadata = {
  schema: "public",
  name: "orders",
  primaryKey: ["id"],
  columns: [
    { name: "id", nativeType: "int4", type: "number", nullable: false },
    { name: "user_id", nativeType: "int4", type: "number", nullable: false },
    { name: "weird-name", nativeType: "text", type: "string", nullable: true },
  ],
  indexes: [],
  foreignKeys: [
    {
      field: "user_id",
      referencedSchema: "public",
      referencedTable: "users",
      referencedField: "id",
    },
  ],
};

function parseFormatted(tables: RawTableMetadata[]): Record<string, unknown> {
  return JSON.parse(formatMetadataJson(tables));
}

describe("formatMetadataJson", () => {
  it("emits a parseable JSON document keyed by table name", () => {
    const data = parseFormatted([usersTable, ordersTable]);
    expect(Object.keys(data)).toEqual(["users", "orders"]);
  });

  it("preserves nativeType, generic type, and nullability per field", () => {
    const data = parseFormatted([usersTable]) as {
      users: { fields: Record<string, Record<string, unknown>> };
    };
    expect(data.users.fields.id).toEqual({
      type: "number",
      nullable: false,
      nativeType: "int4",
    });
    expect(data.users.fields.email).toEqual({
      type: "string",
      nullable: false,
      nativeType: "varchar(255)",
      description: "Login email",
    });
    expect(data.users.fields.metadata).toEqual({
      type: "json",
      nullable: true,
      nativeType: "jsonb",
    });
  });

  it.each([
    {
      desc: "table description preserved",
      table: usersTable,
      check: (t: Record<string, unknown>) =>
        expect(t.description).toBe("Application users"),
    },
    {
      desc: "primaryKey preserved",
      table: usersTable,
      check: (t: Record<string, unknown>) => expect(t.primaryKey).toEqual(["id"]),
    },
    {
      desc: "indexes emitted when non-empty",
      table: usersTable,
      check: (t: Record<string, unknown>) =>
        expect(t.indexes).toEqual([
          { name: "users_email_idx", fields: ["email"], isUnique: true },
        ]),
    },
    {
      desc: "foreignKeys emitted when non-empty",
      table: ordersTable,
      check: (t: Record<string, unknown>) =>
        expect(t.foreignKeys).toEqual([
          { fieldName: "user_id", referencedTable: "users", referencedField: "id" },
        ]),
    },
  ])("$desc", ({ table, check }) => {
    const data = parseFormatted([table]) as Record<string, Record<string, unknown>>;
    check(data[table.name]);
  });

  it("omits indexes / foreignKeys arrays when both are empty", () => {
    const tableNoExtras: RawTableMetadata = {
      schema: "public",
      name: "simple",
      primaryKey: [],
      columns: [{ name: "v", nativeType: "text", type: "string", nullable: true }],
      indexes: [],
      foreignKeys: [],
    };
    const data = parseFormatted([tableNoExtras]) as Record<
      string,
      Record<string, unknown>
    >;
    expect("indexes" in data.simple).toBe(false);
    expect("foreignKeys" in data.simple).toBe(false);
  });

  it("preserves arbitrary key names (no quoting concerns in JSON)", () => {
    const data = parseFormatted([ordersTable]) as {
      orders: { fields: Record<string, unknown> };
    };
    expect(data.orders.fields["weird-name"]).toBeDefined();
  });

  it("ends with a trailing newline so files are POSIX-clean", () => {
    expect(formatMetadataJson([usersTable]).endsWith("\n")).toBe(true);
  });

  it("handles empty input as an empty object", () => {
    expect(parseFormatted([])).toEqual({});
  });
});
