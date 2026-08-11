import { describe, it, expect } from "vitest";
import { hasLeadingIndex, unindexedColumnWarning } from "../index-check.js";

describe("hasLeadingIndex", () => {
  it.each([
    {
      label: "leading PK match",
      meta: { primaryKey: ["id"], indexes: [] },
      column: "id",
      expected: true,
    },
    {
      label: "leading column of composite PK",
      meta: { primaryKey: ["tenant_id", "user_id"], indexes: [] },
      column: "tenant_id",
      expected: true,
    },
    {
      label: "trailing column of composite PK",
      meta: { primaryKey: ["tenant_id", "user_id"], indexes: [] },
      column: "user_id",
      expected: false,
    },
    {
      label: "leading column of a single-column index",
      meta: {
        primaryKey: ["id"],
        indexes: [{ name: "ix_role", fields: ["role"], isUnique: false }],
      },
      column: "role",
      expected: true,
    },
    {
      label: "leading column of a composite index",
      meta: {
        primaryKey: ["id"],
        indexes: [
          { name: "ix_a_b", fields: ["a", "b"], isUnique: false },
        ],
      },
      column: "a",
      expected: true,
    },
    {
      label: "trailing column of a composite index",
      meta: {
        primaryKey: ["id"],
        indexes: [
          { name: "ix_a_b", fields: ["a", "b"], isUnique: false },
        ],
      },
      column: "b",
      expected: false,
    },
    {
      label: "no leading index for the queried column",
      meta: {
        primaryKey: ["id"],
        indexes: [
          { name: "ix_status", fields: ["status"], isUnique: false },
        ],
      },
      column: "email",
      expected: false,
    },
    {
      label: "indexes undefined (info missing) is treated as 'silence'",
      meta: { primaryKey: ["id"] },
      column: "email",
      expected: true,
    },
    {
      label: "primaryKey undefined falls through to indexes",
      meta: {
        indexes: [{ name: "ix_a", fields: ["a"], isUnique: false }],
      },
      column: "a",
      expected: true,
    },
  ])("$label", ({ meta, column, expected }) => {
    expect(hasLeadingIndex({ meta, column })).toBe(expected);
  });
});

describe("unindexedColumnWarning", () => {
  it("includes both the table and column name in the message", () => {
    const msg = unindexedColumnWarning({ table: "users", column: "email" });
    expect(msg).toContain("users");
    expect(msg).toContain("email");
    expect(msg).toMatch(/index|scan/i);
  });
});
