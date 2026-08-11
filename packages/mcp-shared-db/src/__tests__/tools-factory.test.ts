import { describe, it, expect } from "vitest";
import { createDatabaseTools } from "../tools-factory.js";
import type { SelectableFieldsMap } from "../selectable-fields.js";
import type { TableMetadataMap } from "../metadata.js";
import { createFakeDataSource } from "./fixtures/fake-data-source.js";

const selectableFields: SelectableFieldsMap = {
  users: {
    fields: { id: { select: "expose" }, name: { select: "redact", note: "real name" } },
  },
};

const tableMetadata: TableMetadataMap = {
  users: {
    tableName: "users",
    primaryKey: ["id"],
    fields: {
      id: { type: "number", nullable: false },
      name: { type: "string", nullable: false },
    },
  },
};

function setupTools(prefix?: string) {
  const fake = createFakeDataSource();
  return createDatabaseTools({
    selectableFields,
    tableMetadata,
    getDataSource: async () => fake.dataSource,
    ...(prefix && { toolPrefix: prefix }),
  });
}

describe("createDatabaseTools", () => {
  it("returns a [describe, execute] tool pair with default 'db' prefix", () => {
    const [describe, execute] = setupTools();
    expect(describe.name).toBe("db_describe");
    expect(execute.name).toBe("db_execute");
  });

  it("respects custom toolPrefix", () => {
    const [describe, execute] = setupTools("myprefix");
    expect(describe.name).toBe("myprefix_describe");
    expect(execute.name).toBe("myprefix_execute");
  });

  it("describe lists registered operations", async () => {
    const [describe] = setupTools();
    const result = await describe.execute({});
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("list_tables");
    expect(text).toContain("describe_table");
    expect(text).toContain("get_by_pk");
    expect(text).toContain("Discovery");
    expect(text).toContain("Read");
  });

  it("execute routes to list_tables (no DataSource call)", async () => {
    const [, execute] = setupTools();
    const result = await execute.execute({ operation: "list_tables", params: {} });
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.count).toBe(1);
    expect(data.tables[0].name).toBe("users");
  });

  it("execute returns error for unknown operation", async () => {
    const [, execute] = setupTools();
    const result = await execute.execute({ operation: "drop_database", params: {} });
    expect(result.isError).toBe(true);
  });

  it("forwards custom describe/execute descriptions and preamble", async () => {
    const fake = createFakeDataSource();
    const [describe, execute] = createDatabaseTools({
      selectableFields,
      tableMetadata,
      getDataSource: async () => fake.dataSource,
      describeDescription: "custom describe desc",
      executeDescription: "custom execute desc",
      preamble: "custom preamble line",
    });
    expect(describe.description).toBe("custom describe desc");
    expect(execute.description).toBe("custom execute desc");

    const listing = await describe.execute({});
    const text = (listing.content[0] as { text: string }).text;
    expect(text).toContain("custom preamble line");
  });

  it("invokes getDataSource on each execute that needs it (lazy)", async () => {
    const fake = createFakeDataSource({ findByPk: { id: 1, name: "Alice" } });
    let callCount = 0;
    const [, execute] = createDatabaseTools({
      selectableFields,
      tableMetadata,
      getDataSource: async () => {
        callCount += 1;
        return fake.dataSource;
      },
    });
    // list_tables doesn't need a DataSource, but execute still builds context.
    await execute.execute({ operation: "list_tables", params: {} });
    expect(callCount).toBe(1);
    await execute.execute({
      operation: "get_by_pk",
      params: { table: "users", pk: 1 },
    });
    expect(callCount).toBe(2);
    expect(fake.findByPk).toHaveBeenCalled();
  });
});
