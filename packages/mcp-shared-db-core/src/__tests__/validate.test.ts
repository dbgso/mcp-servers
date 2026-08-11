import { describe, it, expect } from "vitest";
import {
  validateSelectableFieldsCoverage,
  type ValidationIssue,
  type ValidationIssueKind,
} from "../validate.js";
import type { RdbTableMetadataMap } from "../rdb-metadata.js";
import type { SelectableFieldsMap } from "../selectable-fields.js";

const baseMetadata: RdbTableMetadataMap = {
  users: {
    tableName: "users",
    primaryKey: ["id"],
    fields: {
      id: { type: "string", nullable: false },
      email: { type: "string", nullable: false },
      first_name: { type: "string", nullable: false },
    },
  },
  orders: {
    tableName: "orders",
    primaryKey: ["id"],
    fields: {
      id: { type: "string", nullable: false },
      user_id: { type: "string", nullable: false },
    },
  },
};

const baseSelectable: SelectableFieldsMap = {
  users: {
    fields: {
      id: {},
      email: { pii: true, piiReason: "email address" },
      first_name: { pii: true, piiReason: "real name" },
    },
  },
  orders: {
    fields: {
      id: {},
      user_id: {},
    },
  },
};

function findIssues(
  issues: ValidationIssue[],
  kind: ValidationIssueKind,
): ValidationIssue[] {
  return issues.filter((i) => i.kind === kind);
}

describe("validateSelectableFieldsCoverage — happy path", () => {
  it("reports zero issues when metadata and selectableFields are aligned", () => {
    const result = validateSelectableFieldsCoverage({
      metadata: baseMetadata,
      selectableFields: baseSelectable,
    });
    expect(result.issues).toEqual([]);
    expect(result.summary).toEqual({
      tablesChecked: 2,
      fieldsChecked: 5,
      piiMarkedCount: 2,
      issuesByKind: {},
      piiOverapplyByKind: { temporal: 0, boolean: 0, enum: 0, numericFk: 0 },
      likelyOverApplication: false,
    });
  });
});

describe("validateSelectableFieldsCoverage — drift detection", () => {
  it.each<{
    name: string;
    metadata: RdbTableMetadataMap;
    selectableFields: SelectableFieldsMap;
    kind: ValidationIssueKind;
    expectField?: string;
    expectTable: string;
    expectSeverity: "error" | "warn";
  }>([
    {
      name: "missing_table — table only in metadata",
      metadata: baseMetadata,
      selectableFields: { users: baseSelectable.users },
      kind: "missing_table",
      expectTable: "orders",
      expectSeverity: "error",
    },
    {
      name: "orphan_table — table only in selectableFields",
      metadata: { users: baseMetadata.users },
      selectableFields: baseSelectable,
      kind: "orphan_table",
      expectTable: "orders",
      expectSeverity: "error",
    },
    {
      name: "missing_field — field only in metadata",
      metadata: baseMetadata,
      selectableFields: {
        ...baseSelectable,
        users: { fields: { id: {}, email: { pii: true, piiReason: "x" } } },
      },
      kind: "missing_field",
      expectField: "first_name",
      expectTable: "users",
      expectSeverity: "error",
    },
    {
      name: "orphan_field — field only in selectableFields",
      metadata: baseMetadata,
      selectableFields: {
        ...baseSelectable,
        orders: { fields: { id: {}, user_id: {}, ghost: {} } },
      },
      kind: "orphan_field",
      expectField: "ghost",
      expectTable: "orders",
      expectSeverity: "error",
    },
    {
      name: "missing_pii_reason — pii: true with no reason",
      metadata: baseMetadata,
      selectableFields: {
        ...baseSelectable,
        users: { fields: { id: {}, email: { pii: true }, first_name: {} } },
      },
      kind: "missing_pii_reason",
      expectField: "email",
      expectTable: "users",
      expectSeverity: "warn",
    },
    {
      name: "missing_pii_reason — pii: true with whitespace-only reason",
      metadata: baseMetadata,
      selectableFields: {
        ...baseSelectable,
        users: {
          fields: {
            id: {},
            email: { pii: true, piiReason: "   " },
            first_name: {},
          },
        },
      },
      kind: "missing_pii_reason",
      expectField: "email",
      expectTable: "users",
      expectSeverity: "warn",
    },
  ])("$name", ({ metadata, selectableFields, kind, expectField, expectTable, expectSeverity }) => {
    const result = validateSelectableFieldsCoverage({ metadata, selectableFields });
    const matched = findIssues(result.issues, kind);
    expect(matched.length).toBeGreaterThan(0);
    const i = matched[0];
    expect(i.table).toBe(expectTable);
    if (expectField !== undefined) expect(i.field).toBe(expectField);
    expect(i.severity).toBe(expectSeverity);
    expect(result.summary.issuesByKind[kind]).toBeGreaterThan(0);
  });
});

describe("validateSelectableFieldsCoverage — summary counters", () => {
  it("counts pii-marked fields including ones missing a reason", () => {
    const result = validateSelectableFieldsCoverage({
      metadata: baseMetadata,
      selectableFields: {
        ...baseSelectable,
        users: {
          fields: {
            id: {},
            email: { pii: true }, // no reason → counted as PII + emits warn
            first_name: { pii: true, piiReason: "real name" },
          },
        },
      },
    });
    expect(result.summary.piiMarkedCount).toBe(2);
    expect(result.summary.issuesByKind.missing_pii_reason).toBe(1);
  });

  it("does not double-count tables when both sides differ", () => {
    const metadata: RdbTableMetadataMap = { users: baseMetadata.users };
    const selectableFields: SelectableFieldsMap = {
      orders: { fields: { id: {} } },
    };
    const result = validateSelectableFieldsCoverage({ metadata, selectableFields });
    expect(result.summary.tablesChecked).toBe(0);
    // Both a missing_table and an orphan_table issue.
    expect(result.summary.issuesByKind.missing_table).toBe(1);
    expect(result.summary.issuesByKind.orphan_table).toBe(1);
  });
});

describe("validateSelectableFieldsCoverage — pii over-apply heuristic", () => {
  it.each<{
    name: string;
    nativeType: string;
    fieldName: string;
    expectKind: ValidationIssueKind;
  }>([
    {
      name: "pii_on_temporal — created_at timestamp",
      nativeType: "timestamp",
      fieldName: "created_at",
      expectKind: "pii_on_temporal",
    },
    {
      name: "pii_on_boolean — tinyint(1) flag",
      nativeType: "tinyint(1)",
      fieldName: "is_deleted",
      expectKind: "pii_on_boolean",
    },
    {
      name: "pii_on_enum — status enum",
      nativeType: "enum('Draft','Published','Archived')",
      fieldName: "status",
      expectKind: "pii_on_enum",
    },
    {
      name: "pii_on_numeric_fk — bigint user_id",
      nativeType: "bigint",
      fieldName: "user_id",
      expectKind: "pii_on_numeric_fk",
    },
    {
      name: "pii_on_numeric_fk — int4 id",
      nativeType: "int4",
      fieldName: "id",
      expectKind: "pii_on_numeric_fk",
    },
  ])("$name", ({ nativeType, fieldName, expectKind }) => {
    const metadata: RdbTableMetadataMap = {
      t: {
        tableName: "t",
        primaryKey: ["id"],
        fields: { [fieldName]: { type: "string", nullable: false, nativeType } },
      },
    };
    const selectableFields: SelectableFieldsMap = {
      t: { fields: { [fieldName]: { pii: true, piiReason: "x" } } },
    };
    const result = validateSelectableFieldsCoverage({ metadata, selectableFields });
    const matched = findIssues(result.issues, expectKind);
    expect(matched.length).toBe(1);
    expect(matched[0].field).toBe(fieldName);
    expect(matched[0].severity).toBe("warn");
    expect(matched[0].message).toContain(nativeType);
  });

  it("does not warn on a pii: true varchar (text — possible free text)", () => {
    const metadata: RdbTableMetadataMap = {
      t: {
        tableName: "t",
        primaryKey: ["id"],
        fields: { email: { type: "string", nullable: false, nativeType: "varchar(255)" } },
      },
    };
    const selectableFields: SelectableFieldsMap = {
      t: { fields: { email: { pii: true, piiReason: "login email" } } },
    };
    const result = validateSelectableFieldsCoverage({ metadata, selectableFields });
    expect(
      result.issues.filter((i) => i.kind.startsWith("pii_on_")).length,
    ).toBe(0);
  });

  it("does not warn when the column is not pii: true", () => {
    const metadata: RdbTableMetadataMap = {
      t: {
        tableName: "t",
        primaryKey: ["id"],
        fields: { created_at: { type: "datetime", nullable: false, nativeType: "timestamp" } },
      },
    };
    const selectableFields: SelectableFieldsMap = {
      t: { fields: { created_at: {} } },
    };
    const result = validateSelectableFieldsCoverage({ metadata, selectableFields });
    expect(
      result.issues.filter((i) => i.kind.startsWith("pii_on_")).length,
    ).toBe(0);
  });

  it("fails open when nativeType is missing (older metadata files)", () => {
    const metadata: RdbTableMetadataMap = {
      t: {
        tableName: "t",
        primaryKey: ["id"],
        fields: { created_at: { type: "datetime", nullable: false } }, // no nativeType
      },
    };
    const selectableFields: SelectableFieldsMap = {
      t: { fields: { created_at: { pii: true, piiReason: "x" } } },
    };
    const result = validateSelectableFieldsCoverage({ metadata, selectableFields });
    expect(
      result.issues.filter((i) => i.kind.startsWith("pii_on_")).length,
    ).toBe(0);
  });

  it("does not warn on a numeric column whose name is not FK-shaped", () => {
    const metadata: RdbTableMetadataMap = {
      t: {
        tableName: "t",
        primaryKey: ["age"],
        fields: { age: { type: "number", nullable: false, nativeType: "int4" } },
      },
    };
    const selectableFields: SelectableFieldsMap = {
      t: { fields: { age: { pii: true, piiReason: "potentially identifying" } } },
    };
    const result = validateSelectableFieldsCoverage({ metadata, selectableFields });
    expect(
      result.issues.filter((i) => i.kind.startsWith("pii_on_")).length,
    ).toBe(0);
  });
});

describe("validateSelectableFieldsCoverage — likelyOverApplication flag", () => {
  /** Build a single-table case with N timestamp fields all marked pii: true. */
  function makeTemporalCase(count: number): {
    metadata: RdbTableMetadataMap;
    selectableFields: SelectableFieldsMap;
  } {
    const fields: Record<string, { type: "datetime"; nullable: false; nativeType: string }> = {};
    const sel: Record<string, { pii: true; piiReason: string }> = {};
    for (let i = 0; i < count; i += 1) {
      fields[`ts_${i}`] = { type: "datetime", nullable: false, nativeType: "timestamp" };
      sel[`ts_${i}`] = { pii: true, piiReason: "x" };
    }
    return {
      metadata: { t: { tableName: "t", primaryKey: ["ts_0"], fields } },
      selectableFields: { t: { fields: sel } },
    };
  }

  it("trips when one table has 3+ same-kind warns", () => {
    const result = validateSelectableFieldsCoverage(makeTemporalCase(3));
    expect(result.summary.likelyOverApplication).toBe(true);
    expect(result.summary.piiOverapplyByKind.temporal).toBe(3);
  });

  it("trips when DB-wide same-kind warn count reaches 10 (split across tables)", () => {
    // 10 tables × 1 timestamp field — neither hits per-table 3 but global hits 10.
    const metadata: RdbTableMetadataMap = {};
    const selectableFields: SelectableFieldsMap = {};
    for (let i = 0; i < 10; i += 1) {
      const tName = `t${i}`;
      metadata[tName] = {
        tableName: tName,
        primaryKey: ["created_at"],
        fields: { created_at: { type: "datetime", nullable: false, nativeType: "timestamp" } },
      };
      selectableFields[tName] = { fields: { created_at: { pii: true, piiReason: "x" } } };
    }
    const result = validateSelectableFieldsCoverage({ metadata, selectableFields });
    expect(result.summary.piiOverapplyByKind.temporal).toBe(10);
    expect(result.summary.likelyOverApplication).toBe(true);
  });

  it("does NOT trip with 2 per-table + 9 global", () => {
    // 4 tables: t0/t1/t2 with 2 temporal warns each (=6), t3 with 3 numericFk (=3 total, but
    // numericFk only). Per-table max = 3 for t3, so this would actually trip. Use a
    // configuration where every per-table count stays under 3 AND global stays under 10.
    // Setup: 4 tables, each with 2 temporal warns + 0 numericFk → per-table max = 2, global temporal = 8.
    const metadata: RdbTableMetadataMap = {};
    const selectableFields: SelectableFieldsMap = {};
    for (let i = 0; i < 4; i += 1) {
      const tName = `t${i}`;
      metadata[tName] = {
        tableName: tName,
        primaryKey: ["a"],
        fields: {
          a: { type: "datetime", nullable: false, nativeType: "timestamp" },
          b: { type: "datetime", nullable: false, nativeType: "datetime" },
        },
      };
      selectableFields[tName] = {
        fields: {
          a: { pii: true, piiReason: "x" },
          b: { pii: true, piiReason: "x" },
        },
      };
    }
    const result = validateSelectableFieldsCoverage({ metadata, selectableFields });
    expect(result.summary.piiOverapplyByKind.temporal).toBe(8);
    expect(result.summary.likelyOverApplication).toBe(false);
  });
});
