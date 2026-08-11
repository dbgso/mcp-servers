import { describe, it, expect } from "vitest";
import { listTablesOp } from "../operations/list-tables.js";
import { describeTableOp } from "../operations/describe-table.js";
import { databaseRegistry, allDatabaseOperations } from "../operations/registry.js";
import type { DatabaseOperationContext } from "../operations/types.js";
import type { SelectableFieldsMap } from "../selectable-fields.js";
import type { TableMetadataMap } from "../metadata.js";

const selectableFields: SelectableFieldsMap = {
  users: {
    fields: {
      id: { select: "expose" },
      name: { pii: true, piiReason: "real name" }, // legacy form (back-compat coverage)
      email: { pii: true }, // legacy form (back-compat coverage)
      createdAt: { select: "expose" },
    },
  },
  products: {
    fields: {
      id: { select: "expose" },
      name: { select: "expose" },
      price: { select: "expose" },
    },
  },
};

const tableMetadata: TableMetadataMap = {
  users: {
    tableName: "users",
    description: "Application users",
    primaryKey: ["id"],
    fields: {
      id: { type: "number", nullable: false },
      name: { type: "string", nullable: false },
      email: { type: "string", nullable: true },
      createdAt: { type: "datetime", nullable: false },
    },
  },
  products: {
    tableName: "products",
    primaryKey: ["id"],
    fields: {
      id: { type: "number", nullable: false },
      name: { type: "string", nullable: false },
      price: { type: "number", nullable: false },
    },
  },
};

// Tests for the no-DB-call discovery operations don't need a real DataSource.
const ctx = {
  dataSource: undefined,
  selectableFields,
  tableMetadata,
} as unknown as DatabaseOperationContext;

function parseResponse(result: { content: { text: string }[] }): unknown {
  return JSON.parse(result.content[0].text);
}

describe("databaseRegistry", () => {
  it("registers all 8 operations", () => {
    expect(allDatabaseOperations).toHaveLength(8);
    const ids = allDatabaseOperations.map((o) => o.id).sort();
    expect(ids).toEqual([
      "describe_table",
      "explain_sql",
      "get_by_date_range",
      "get_by_fk",
      "get_by_index",
      "get_by_pk",
      "json_search",
      "list_tables",
    ]);
  });

  it("registry.get returns the operation by id", () => {
    expect(databaseRegistry.get("list_tables")?.id).toBe("list_tables");
    expect(databaseRegistry.get("missing")).toBeUndefined();
  });

  it("registry.byCategory groups operations", () => {
    const grouped = databaseRegistry.byCategory();
    expect(Object.keys(grouped).sort()).toEqual(["Discovery", "Read"]);
    expect(grouped.Discovery.map((o) => o.id).sort()).toEqual([
      "describe_table",
      "explain_sql",
      "list_tables",
    ]);
  });
});

describe("list_tables operation", () => {
  it("lists tables sorted alphabetically with descriptions", async () => {
    const result = await listTablesOp.execute({ args: {}, ctx });
    const data = parseResponse(result) as { count: number; tables: { name: string; description?: string }[] };
    expect(data.count).toBe(2);
    expect(data.tables.map((t) => t.name)).toEqual(["products", "users"]);
    expect(data.tables[1].description).toBe("Application users");
  });
});

describe("describe_table operation", () => {
  it("merges Layer 1 and Layer 2 for a known table", async () => {
    const result = await describeTableOp.execute({ args: { table: "users" }, ctx });
    const data = parseResponse(result) as {
      table: string;
      primaryKey: string[];
      fields: { name: string; type: string; pii?: boolean }[];
    };
    expect(data.table).toBe("users");
    expect(data.primaryKey).toEqual(["id"]);
    const nameField = data.fields.find((f) => f.name === "name");
    expect(nameField?.pii).toBe(true);
    const idField = data.fields.find((f) => f.name === "id");
    expect(idField?.pii).toBeUndefined();
  });

  it("reports an error with available tables for an unknown table", async () => {
    const result = await describeTableOp.execute({ args: { table: "missing" }, ctx });
    const data = parseResponse(result) as { error: string; availableTables: string[] };
    expect(data.error).toContain("not selectable");
    expect(data.availableTables).toEqual(["products", "users"]);
  });
});
