import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type {
  Introspector,
  RawTableMetadata,
  TableInfo,
} from "../introspect/types.js";
import { listSchemasOp } from "../operations/list-schemas.js";
import { listTablesOp } from "../operations/list-tables.js";
import { introspectTableOp } from "../operations/introspect-table.js";
import { introspectAllOp } from "../operations/introspect-all.js";
import { previewMetadataJsonOp } from "../operations/preview-metadata-json.js";
import { previewSelectableFieldsJsonOp } from "../operations/preview-selectable-fields-json.js";
import { validateSelectableFieldsOp } from "../operations/validate-selectable-fields.js";
import {
  allCodegenOperations,
  codegenRegistry,
} from "../operations/registry.js";

interface FakeIntrospector extends Introspector {
  listSchemas: ReturnType<typeof vi.fn>;
  listTables: ReturnType<typeof vi.fn>;
  introspectTable: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createFakeIntrospector(returns: {
  schemas?: string[];
  tables?: TableInfo[];
  byTable?: Record<string, RawTableMetadata>;
}): FakeIntrospector {
  const listSchemas = vi.fn().mockResolvedValue(returns.schemas ?? []);
  const listTables = vi.fn().mockResolvedValue(returns.tables ?? []);
  const introspectTable = vi.fn(async (input: { schema: string; table: string }) => {
    const metadata = returns.byTable?.[input.table];
    if (!metadata) {
      throw new Error(`No fake metadata for ${input.table}`);
    }
    return metadata;
  });
  const close = vi.fn().mockResolvedValue(undefined);
  return { listSchemas, listTables, introspectTable, close };
}

const usersRaw: RawTableMetadata = {
  schema: "public",
  name: "users",
  primaryKey: ["id"],
  columns: [
    { name: "id", nativeType: "int4", type: "number", nullable: false },
    { name: "email", nativeType: "varchar(255)", type: "string", nullable: false },
  ],
  indexes: [],
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
  foreignKeys: [],
};

function parseJson(result: { content: { text: string }[] }): unknown {
  return JSON.parse(result.content[0].text);
}

describe("codegenRegistry", () => {
  it("registers all 7 phase-2 operations", () => {
    expect(allCodegenOperations).toHaveLength(7);
    const ids = allCodegenOperations.map((o) => o.id).sort();
    expect(ids).toEqual([
      "introspect_all",
      "introspect_table",
      "list_schemas",
      "list_tables",
      "preview_metadata_json",
      "preview_selectable_fields_json",
      "validate_selectable_fields",
    ]);
  });

  it("groups operations by category", () => {
    const grouped = codegenRegistry.byCategory();
    expect(Object.keys(grouped).sort()).toEqual(["Discovery", "Read"]);
    expect(grouped.Discovery.map((o) => o.id).sort()).toEqual([
      "list_schemas",
      "list_tables",
    ]);
  });
});

describe("list_schemas operation", () => {
  it("calls introspector.listSchemas and returns the count", async () => {
    const introspector = createFakeIntrospector({ schemas: ["public", "app"] });
    const result = await listSchemasOp.execute({ args: {}, ctx: { introspector } });
    expect(parseJson(result)).toEqual({ count: 2, schemas: ["public", "app"] });
    expect(introspector.listSchemas).toHaveBeenCalled();
  });
});

describe("list_tables operation", () => {
  it("forwards schema arg to introspector.listTables", async () => {
    const tables: TableInfo[] = [{ schema: "public", name: "users" }];
    const introspector = createFakeIntrospector({ tables });
    const result = await listTablesOp.execute({
      args: { schema: "public" },
      ctx: { introspector },
    });
    expect(parseJson(result)).toEqual({ schema: "public", count: 1, tables });
    expect(introspector.listTables).toHaveBeenCalledWith("public");
  });
});

describe("introspect_table operation", () => {
  it("returns the introspector's full metadata", async () => {
    const introspector = createFakeIntrospector({ byTable: { users: usersRaw } });
    const result = await introspectTableOp.execute({
      args: { schema: "public", table: "users" },
      ctx: { introspector },
    });
    expect(parseJson(result)).toEqual(usersRaw);
    expect(introspector.introspectTable).toHaveBeenCalledWith({
      schema: "public",
      table: "users",
    });
  });
});

describe("introspect_all operation", () => {
  it("walks every table from listTables when no filter is given", async () => {
    const introspector = createFakeIntrospector({
      tables: [
        { schema: "public", name: "users" },
        { schema: "public", name: "orders" },
      ],
      byTable: { users: usersRaw, orders: ordersRaw },
    });
    const result = await introspectAllOp.execute({
      args: { schema: "public" },
      ctx: { introspector },
    });
    const data = parseJson(result) as { count: number; tables: RawTableMetadata[] };
    expect(data.count).toBe(2);
    expect(data.tables.map((t) => t.name)).toEqual(["users", "orders"]);
  });

  it("applies tableFilter case-insensitively", async () => {
    const introspector = createFakeIntrospector({
      tables: [
        { schema: "public", name: "users" },
        { schema: "public", name: "orders" },
        { schema: "public", name: "user_logs" },
      ],
      byTable: { users: usersRaw, user_logs: { ...usersRaw, name: "user_logs" } },
    });
    const result = await introspectAllOp.execute({
      args: { schema: "public", tableFilter: "USER" },
      ctx: { introspector },
    });
    const data = parseJson(result) as { count: number; tables: RawTableMetadata[] };
    expect(data.count).toBe(2);
    expect(data.tables.map((t) => t.name)).toEqual(["users", "user_logs"]);
  });
});

describe("preview_metadata_json operation", () => {
  it("emits parseable JSON keyed by table", async () => {
    const introspector = createFakeIntrospector({
      tables: [{ schema: "public", name: "users" }],
      byTable: { users: usersRaw },
    });
    const result = await previewMetadataJsonOp.execute({
      args: { schema: "public" },
      ctx: { introspector },
    });
    const data = parseJson(result) as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(["users"]);
    expect(data.users).toMatchObject({
      tableName: "users",
      primaryKey: ["id"],
      fields: {
        id: { type: "number", nullable: false, nativeType: "int4" },
        email: { type: "string", nullable: false, nativeType: "varchar(255)" },
      },
    });
  });

  it("respects the explicit `tables` arg and skips listTables", async () => {
    const introspector = createFakeIntrospector({
      byTable: { users: usersRaw, orders: ordersRaw },
    });
    const result = await previewMetadataJsonOp.execute({
      args: { schema: "public", tables: ["orders"] },
      ctx: { introspector },
    });
    const data = parseJson(result) as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(["orders"]);
    expect(introspector.listTables).not.toHaveBeenCalled();
  });

  it("respects tableFilter when no explicit tables list", async () => {
    const introspector = createFakeIntrospector({
      tables: [
        { schema: "public", name: "users" },
        { schema: "public", name: "orders" },
      ],
      byTable: { users: usersRaw, orders: ordersRaw },
    });
    const result = await previewMetadataJsonOp.execute({
      args: { schema: "public", tableFilter: "user" },
      ctx: { introspector },
    });
    const data = parseJson(result) as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(["users"]);
  });
});

describe("preview_selectable_fields_json operation", () => {
  it('emits parseable JSON with { "select": "redact" } per field (secure-by-default)', async () => {
    const introspector = createFakeIntrospector({
      tables: [{ schema: "public", name: "users" }],
      byTable: { users: usersRaw },
    });
    const result = await previewSelectableFieldsJsonOp.execute({
      args: { schema: "public" },
      ctx: { introspector },
    });
    const data = parseJson(result) as Record<
      string,
      { fields: Record<string, Record<string, unknown>> }
    >;
    expect(data.users.fields.id).toEqual({ select: "redact" });
    expect(data.users.fields.email).toEqual({ select: "redact" });
    // Make sure the formatter never auto-marks the legacy pii flag.
    const text = result.content[0].text as string;
    expect(text).not.toContain('"pii"');
    // Operator must hand-edit anything to "expose".
    expect(text).not.toContain('"expose"');
  });

  it("respects explicit tables", async () => {
    const introspector = createFakeIntrospector({
      byTable: { users: usersRaw },
    });
    const result = await previewSelectableFieldsJsonOp.execute({
      args: { schema: "public", tables: ["users"] },
      ctx: { introspector },
    });
    const data = parseJson(result) as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(["users"]);
  });
});

describe("validate_selectable_fields operation", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "validate-op-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns issues + summary when selectable-fields drifts from live schema", async () => {
    const selPath = path.join(tmpDir, "selectable-fields.json");
    // Drift: user_id is missing from selectable-fields, surplus_field is orphan.
    await fs.writeFile(
      selPath,
      JSON.stringify({
        users: { fields: { id: {}, email: { pii: true } } },
        orders: { fields: { id: {}, surplus_field: {} } },
      }),
    );
    const introspector = createFakeIntrospector({
      tables: [
        { schema: "public", name: "users" },
        { schema: "public", name: "orders" },
      ],
      byTable: { users: usersRaw, orders: ordersRaw },
    });
    const result = await validateSelectableFieldsOp.execute({
      args: { schema: "public", selectable_fields_path: selPath },
      ctx: { introspector },
    });
    const data = parseJson(result) as {
      issues: { kind: string; table: string; field?: string }[];
      summary: { tablesChecked: number };
    };
    expect(data.summary.tablesChecked).toBe(2);
    const kinds = data.issues.map((i) => i.kind).sort();
    expect(kinds).toContain("missing_field"); // orders.user_id missing
    expect(kinds).toContain("orphan_field"); // orders.surplus_field
    expect(kinds).toContain("missing_pii_reason"); // users.email pii without reason
  });

  it("reports a useful error when the JSON file is malformed", async () => {
    const selPath = path.join(tmpDir, "broken.json");
    await fs.writeFile(selPath, "{ not json");
    const introspector = createFakeIntrospector({
      tables: [{ schema: "public", name: "users" }],
      byTable: { users: usersRaw },
    });
    await expect(
      validateSelectableFieldsOp.execute({
        args: { schema: "public", selectable_fields_path: selPath },
        ctx: { introspector },
      }),
    ).rejects.toThrow(/Failed to parse selectable_fields_path/);
  });

  it("respects explicit tables filter", async () => {
    const selPath = path.join(tmpDir, "ok.json");
    await fs.writeFile(
      selPath,
      JSON.stringify({ users: { fields: { id: {}, email: {} } } }),
    );
    const introspector = createFakeIntrospector({
      tables: [
        { schema: "public", name: "users" },
        { schema: "public", name: "orders" },
      ],
      byTable: { users: usersRaw, orders: ordersRaw },
    });
    const result = await validateSelectableFieldsOp.execute({
      args: {
        schema: "public",
        selectable_fields_path: selPath,
        tables: ["users"],
      },
      ctx: { introspector },
    });
    const data = parseJson(result) as {
      issues: unknown[];
      summary: { tablesChecked: number };
    };
    expect(data.summary.tablesChecked).toBe(1);
    expect(data.issues).toEqual([]);
    // listTables should NOT be called when explicit tables were given.
    expect(introspector.listTables).not.toHaveBeenCalled();
  });
});
