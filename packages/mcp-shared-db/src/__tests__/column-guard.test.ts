import { describe, expect, it } from "vitest";
import type { SelectableFieldsMap } from "mcp-shared-db-core";
import { resolveColumn, withUnindexedWarning } from "../operations/column-guard.js";
import type { DatabaseOperationContext } from "../operations/types.js";
import type { TableMetadataMap } from "../metadata.js";
import { createFakeDataSource } from "./fixtures/fake-data-source.js";

const selectableFields: SelectableFieldsMap = {
  events: {
    fields: {
      id: { select: "expose" },
      payload: { select: "expose" },
      at: { select: "expose" },
      // Whitelisted, but Layer 1 does not describe it.
      note: { select: "expose" },
    },
  },
};

const tableMetadata: TableMetadataMap = {
  events: {
    tableName: "events",
    primaryKey: ["id"],
    indexes: [],
    fields: {
      id: { type: "number", nullable: false },
      payload: { type: "json", nullable: true },
      at: { type: "datetime", nullable: false },
    },
  },
};

const ctx: DatabaseOperationContext = {
  dataSource: createFakeDataSource().dataSource,
  selectableFields,
  tableMetadata,
};

function refusalBody(result: ReturnType<typeof resolveColumn>): unknown {
  if (!("refusal" in result)) return undefined;
  return JSON.parse(String(result.refusal.content[0]?.text));
}

describe("resolveColumn", () => {
  it("accepts a whitelisted column without metadata when no type is required", () => {
    const result = resolveColumn({ ctx, table: "events", column: "note" });

    expect(result).toEqual({ config: selectableFields.events, meta: tableMetadata.events });
  });

  it("refuses a column that is not whitelisted and lists the ones that are", () => {
    expect(refusalBody(resolveColumn({ ctx, table: "events", column: "secret" }))).toEqual({
      error: "Column 'secret' is not selectable on 'events'.",
      allowedColumns: ["id", "payload", "at", "note"],
    });
  });

  it("refuses a typed lookup on a column Layer 1 does not describe", () => {
    const result = resolveColumn({ ctx, table: "events", column: "note", requiredType: "json" });

    expect(refusalBody(result)).toEqual({ error: "Column 'note' has no metadata on 'events'." });
  });

  it.each([
    { requiredType: "json" as const, column: "at", label: "JSON", type: "datetime" },
    { requiredType: "datetime" as const, column: "payload", label: "datetime", type: "json" },
  ])("names the required $requiredType type in a mismatch", ({ requiredType, column, label, type }) => {
    const result = resolveColumn({ ctx, table: "events", column, requiredType });

    expect(refusalBody(result)).toEqual({
      error: `Column '${column}' on 'events' is not a ${label} column (type: ${type}).`,
    });
  });
});

describe("withUnindexedWarning", () => {
  const meta = tableMetadata.events!;

  it("adds the warning for a column with no leading index", () => {
    const response = withUnindexedWarning({ response: {}, meta, table: "events", column: "at" });

    expect(response.warning).toMatch(/Column 'at' on 'events' has no leading index/);
  });

  it("leaves the response alone for the primary key", () => {
    const response = withUnindexedWarning({ response: {}, meta, table: "events", column: "id" });

    expect(response).toEqual({});
  });
});
