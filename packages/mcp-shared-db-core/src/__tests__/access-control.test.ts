import { describe, it, expect } from "vitest";
import {
  isTableAllowed,
  isColumnAllowed,
  listAvailableTables,
  resolveTable,
} from "../access-control.js";
import type { SelectableFieldsMap } from "../selectable-fields.js";

const fields: SelectableFieldsMap = {
  users: {
    fields: {
      id: { select: "expose" },
      name: { select: "redact" },
      ssn: { select: "exclude" },
      legacy: { pii: true },
      defaulted: {},
    },
  },
  products: { fields: { id: { select: "expose" }, price: { select: "expose" } } },
};

describe("listAvailableTables", () => {
  it("returns whitelisted tables sorted alphabetically", () => {
    expect(listAvailableTables(fields)).toEqual(["products", "users"]);
  });

  it("returns an empty array for an empty map", () => {
    expect(listAvailableTables({})).toEqual([]);
  });
});

describe("isTableAllowed", () => {
  it.each([
    { tableName: "users", expected: true },
    { tableName: "products", expected: true },
    { tableName: "missing", expected: false },
    { tableName: "", expected: false },
  ])("$tableName → $expected", ({ tableName, expected }) => {
    expect(isTableAllowed({ selectableFields: fields, tableName })).toBe(expected);
  });
});

describe("isColumnAllowed", () => {
  it.each([
    // (table, column, expected, reason)
    { tableName: "users", column: "id", expected: true, reason: "select=expose is allowed" },
    { tableName: "users", column: "name", expected: true, reason: "select=redact is still queryable" },
    { tableName: "users", column: "legacy", expected: true, reason: "legacy pii=true → redact → queryable" },
    { tableName: "users", column: "defaulted", expected: true, reason: "unspecified → redact → queryable" },
    { tableName: "users", column: "ssn", expected: false, reason: "select=exclude is rejected" },
    { tableName: "users", column: "absent", expected: false, reason: "column not in whitelist" },
    { tableName: "missing", column: "id", expected: false, reason: "table not in whitelist" },
    { tableName: "products", column: "price", expected: true, reason: "second table works too" },
  ])("$tableName.$column → $expected ($reason)", ({ tableName, column, expected }) => {
    expect(isColumnAllowed({ selectableFields: fields, tableName, column })).toBe(expected);
  });
});

describe("resolveTable", () => {
  const tableMetadata = { users: { primaryKey: ["id"] }, orphan: { primaryKey: [] } };
  const ctx = { selectableFields: fields, tableMetadata };

  it("returns the whitelist entry and metadata of a table in both layers", () => {
    expect(resolveTable({ ctx, table: "users" })).toEqual({
      config: fields.users,
      meta: tableMetadata.users,
    });
  });

  it.each([
    { table: "products", why: "no metadata" },
    { table: "orphan", why: "not whitelisted" },
    { table: "missing", why: "in neither layer" },
  ])("refuses $table ($why) and lists the selectable tables", ({ table }) => {
    const resolved = resolveTable({ ctx, table });

    expect("refusal" in resolved).toBe(true);
    const text = "refusal" in resolved ? resolved.refusal.content[0]?.text : "";
    expect(JSON.parse(String(text))).toEqual({
      error: `Table '${table}' is not selectable.`,
      availableTables: ["products", "users"],
    });
  });
});
