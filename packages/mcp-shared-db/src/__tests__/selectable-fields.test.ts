// Tests for the PII / whitelist concept live in `mcp-shared-db-core`.
// This file just verifies the re-export path remains stable.
import { describe, it, expect } from "vitest";
import {
  redactPii,
  redactPiiMany,
  getAllFieldNames,
  type TableConfig,
} from "../selectable-fields.js";

describe("re-exports from mcp-shared-db-core", () => {
  it("exposes the redaction helpers (new select form)", () => {
    const table: TableConfig = {
      fields: {
        id: { select: "expose" },
        name: { select: "redact", note: "real name" },
      },
    };
    const out = redactPii({ row: { id: 1, name: "Alice" }, table });
    expect(out).toEqual({ id: 1, name: "[REDACTED]" });
    expect(redactPiiMany({ rows: [{ id: 1, name: "Bob" }], table })[0].name).toBe("[REDACTED]");
    expect(getAllFieldNames(table).sort()).toEqual(["id", "name"]);
  });

  it("still honors the legacy pii flag through the re-export", () => {
    const table: TableConfig = {
      fields: { id: { select: "expose" }, name: { pii: true } },
    };
    expect(redactPii({ row: { id: 1, name: "Alice" }, table }).name).toBe("[REDACTED]");
  });
});
