import { describe, it, expect } from "vitest";
import { toRdbMetadataMap } from "../format/to-rdb-metadata.js";
import type { RawTableMetadata } from "../introspect/types.js";

const usersRaw: RawTableMetadata = {
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
      default: "''",
    },
  ],
  indexes: [{ name: "users_email_idx", fields: ["email"], isUnique: true }],
  foreignKeys: [],
};

const ordersRaw: RawTableMetadata = {
  schema: "public",
  name: "orders",
  primaryKey: ["id"],
  columns: [
    { name: "id", nativeType: "int4", type: "number", nullable: false },
    { name: "user_id", nativeType: "int4", type: "number", nullable: false },
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

describe("toRdbMetadataMap", () => {
  it("preserves description, primaryKey, field info, and nativeType", () => {
    const out = toRdbMetadataMap([usersRaw]);
    expect(out.users.description).toBe("Application users");
    expect(out.users.primaryKey).toEqual(["id"]);
    expect(out.users.fields.id).toEqual({
      type: "number",
      nullable: false,
      nativeType: "int4",
    });
    expect(out.users.fields.email).toEqual({
      type: "string",
      nullable: false,
      description: "Login email",
      default: "''",
      nativeType: "varchar(255)",
    });
  });

  it("omits nativeType when the source RawColumn lacks it", () => {
    const noNative: RawTableMetadata = {
      schema: "public",
      name: "items",
      primaryKey: ["id"],
      columns: [{ name: "id", nativeType: "", type: "number", nullable: false }],
      indexes: [],
      foreignKeys: [],
    };
    const out = toRdbMetadataMap([noNative]);
    expect("nativeType" in out.items.fields.id).toBe(false);
  });

  it("emits indexes when non-empty, omits otherwise", () => {
    const withIdx = toRdbMetadataMap([usersRaw]);
    expect(withIdx.users.indexes).toEqual([
      { name: "users_email_idx", fields: ["email"], isUnique: true },
    ]);
    const withoutIdx = toRdbMetadataMap([ordersRaw]);
    expect("indexes" in withoutIdx.orders).toBe(false);
  });

  it("re-keys foreignKeys from `field` to `fieldName`", () => {
    const out = toRdbMetadataMap([ordersRaw]);
    expect(out.orders.foreignKeys).toEqual([
      { fieldName: "user_id", referencedTable: "users", referencedField: "id" },
    ]);
  });

  it("omits foreignKeys when input is empty", () => {
    const out = toRdbMetadataMap([usersRaw]);
    expect("foreignKeys" in out.users).toBe(false);
  });

  it("returns an empty map for empty input", () => {
    expect(toRdbMetadataMap([])).toEqual({});
  });
});
