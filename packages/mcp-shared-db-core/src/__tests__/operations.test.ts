import { describe, it, expect } from "vitest";
import { listTablesOp } from "../operations/list-tables.js";
import { describeTableOp } from "../operations/describe-table.js";
import type { DatabaseCoreContext } from "../types.js";

const ctx: DatabaseCoreContext = {
  selectableFields: {
    users: {
      description: "App users",
      fields: { id: {}, name: { pii: true, piiReason: "real name" } },
    },
    products: { fields: { id: {}, price: {} } },
  },
  tableMetadata: {
    users: {
      tableName: "users",
      description: "Application users (from metadata)",
      primaryKey: ["id"],
      fields: {
        id: { type: "number", nullable: false },
        name: { type: "string", nullable: false },
      },
    },
    products: {
      tableName: "products",
      primaryKey: ["id"],
      fields: {
        id: { type: "number", nullable: false },
        price: { type: "number", nullable: false },
      },
    },
  },
};

function parseResponse(result: { content: { text: string }[] }): unknown {
  return JSON.parse(result.content[0].text);
}

describe("listTablesOp", () => {
  it("lists tables sorted alphabetically with metadata description", async () => {
    const result = await listTablesOp.execute({ args: {}, ctx });
    const data = parseResponse(result) as { count: number; tables: { name: string; description?: string }[] };
    expect(data.count).toBe(2);
    expect(data.tables.map((t) => t.name)).toEqual(["products", "users"]);
    expect(data.tables[1].description).toBe("Application users (from metadata)");
  });

  it("falls back to selectable-fields description when metadata description is missing", async () => {
    const ctxWithoutMetaDescription: DatabaseCoreContext = {
      ...ctx,
      tableMetadata: {
        users: { ...ctx.tableMetadata.users, description: undefined },
        products: ctx.tableMetadata.products,
      },
    };
    const result = await listTablesOp.execute({ args: {}, ctx: ctxWithoutMetaDescription });
    const data = parseResponse(result) as { tables: { name: string; description?: string }[] };
    expect(data.tables[1].description).toBe("App users");
  });
});

describe("describeTableOp", () => {
  it("merges Layer 1 + Layer 2 for a known table", async () => {
    const result = await describeTableOp.execute({ args: { table: "users" }, ctx });
    const data = parseResponse(result) as {
      table: string;
      primaryKey: string[];
      fields: { name: string; type: string; pii?: boolean; piiReason?: string }[];
    };
    expect(data.table).toBe("users");
    expect(data.primaryKey).toEqual(["id"]);
    const nameField = data.fields.find((f) => f.name === "name");
    expect(nameField?.pii).toBe(true);
    expect(nameField?.piiReason).toBe("real name");
    const idField = data.fields.find((f) => f.name === "id");
    expect(idField?.pii).toBeUndefined();
  });

  it("reports an error with available tables for an unknown table", async () => {
    const result = await describeTableOp.execute({ args: { table: "missing" }, ctx });
    const data = parseResponse(result) as { error: string; availableTables: string[] };
    expect(data.error).toContain("not selectable");
    expect(data.availableTables).toEqual(["products", "users"]);
  });

  it("includes per-field default and description when present in metadata", async () => {
    const richCtx: DatabaseCoreContext = {
      selectableFields: { events: { fields: { kind: {}, count: {} } } },
      tableMetadata: {
        events: {
          tableName: "events",
          primaryKey: ["kind"],
          fields: {
            kind: {
              type: "string",
              nullable: false,
              description: "event kind",
              default: "unknown",
            },
            count: { type: "number", nullable: false, default: 0 },
          },
        },
      },
    };
    const result = await describeTableOp.execute({ args: { table: "events" }, ctx: richCtx });
    const data = parseResponse(result) as {
      fields: { name: string; default?: unknown; description?: string }[];
    };
    const kindField = data.fields.find((f) => f.name === "kind");
    expect(kindField?.default).toBe("unknown");
    expect(kindField?.description).toBe("event kind");
    const countField = data.fields.find((f) => f.name === "count");
    expect(countField?.default).toBe(0);
    expect(countField?.description).toBeUndefined();
  });

  it("falls back to default type/nullable when a field lacks Layer-1 metadata", async () => {
    const ctxMissingMeta: DatabaseCoreContext = {
      selectableFields: { sparse: { fields: { unknownField: {} } } },
      tableMetadata: {
        sparse: {
          tableName: "sparse",
          primaryKey: [],
          fields: {} as never,
        },
      },
    };
    const result = await describeTableOp.execute({
      args: { table: "sparse" },
      ctx: ctxMissingMeta,
    });
    const data = parseResponse(result) as {
      fields: { name: string; type: string; nullable: boolean }[];
    };
    expect(data.fields[0].type).toBe("string");
    expect(data.fields[0].nullable).toBe(true);
  });
});
