import { describe, it, expect } from "vitest";
import {
  getAllFieldNames,
  getEffectiveNote,
  getEffectivePolicy,
  getQueryableFieldNames,
  redactPii,
  redactPiiMany,
  type SelectableFieldInfo,
  type TableConfig,
} from "../selectable-fields.js";

describe("getEffectivePolicy", () => {
  it.each([
    { label: "select=expose", info: { select: "expose" } as SelectableFieldInfo, expected: "expose" },
    { label: "select=redact", info: { select: "redact" } as SelectableFieldInfo, expected: "redact" },
    { label: "select=exclude", info: { select: "exclude" } as SelectableFieldInfo, expected: "exclude" },
    { label: "unspecified → redact (new secure default)", info: {} as SelectableFieldInfo, expected: "redact" },
    { label: "legacy pii=true → redact", info: { pii: true } as SelectableFieldInfo, expected: "redact" },
    { label: "legacy pii=false → redact (default)", info: { pii: false } as SelectableFieldInfo, expected: "redact" },
    { label: "select=expose wins over legacy pii=true", info: { select: "expose", pii: true } as SelectableFieldInfo, expected: "expose" },
    { label: "select=exclude wins over legacy pii=true", info: { select: "exclude", pii: true } as SelectableFieldInfo, expected: "exclude" },
  ])("$label", ({ info, expected }) => {
    expect(getEffectivePolicy(info)).toBe(expected);
  });
});

describe("getEffectiveNote", () => {
  it.each([
    { label: "note set", info: { note: "internal" } as SelectableFieldInfo, expected: "internal" },
    { label: "piiReason set (legacy)", info: { piiReason: "real name" } as SelectableFieldInfo, expected: "real name" },
    { label: "note wins over piiReason", info: { note: "new", piiReason: "old" } as SelectableFieldInfo, expected: "new" },
    { label: "neither set", info: {} as SelectableFieldInfo, expected: undefined },
    { label: "empty string → undefined", info: { note: "" } as SelectableFieldInfo, expected: undefined },
    { label: "whitespace only → undefined", info: { note: "   " } as SelectableFieldInfo, expected: undefined },
    { label: "trims surrounding whitespace", info: { note: "  hello  " } as SelectableFieldInfo, expected: "hello" },
  ])("$label", ({ info, expected }) => {
    expect(getEffectiveNote(info)).toBe(expected);
  });
});

describe("getAllFieldNames / getQueryableFieldNames", () => {
  const table: TableConfig = {
    fields: {
      id: { select: "expose" },
      name: { select: "redact" },
      ssn: { select: "exclude" },
      internal: {}, // unspecified → redact
      legacy: { pii: true }, // legacy → redact
    },
  };

  it("getAllFieldNames returns every declared field, in declaration order", () => {
    expect(getAllFieldNames(table)).toEqual(["id", "name", "ssn", "internal", "legacy"]);
  });

  it("getQueryableFieldNames omits 'exclude' fields, preserves order", () => {
    expect(getQueryableFieldNames(table)).toEqual(["id", "name", "internal", "legacy"]);
  });
});

describe("redactPii — per-field policy on a multi-field table", () => {
  const table: TableConfig = {
    fields: {
      id: { select: "expose" },
      name: { select: "redact" },
      ssn: { select: "exclude" },
      internal: {}, // unspecified → redact (secure default)
      legacy: { pii: true }, // legacy → redact
    },
  };
  const row = { id: 1, name: "Alice", ssn: "ssn-secret", internal: "internal-secret", legacy: "legacy-secret" };

  // Single redaction pass — every per-field assertion checks the same `out`,
  // so all five field outcomes share one fixture run.
  const out = redactPii({ row: { ...row }, table });

  it.each([
    { field: "id", reason: "expose passes through", check: (v: unknown) => expect(v).toBe(1) },
    { field: "name", reason: "redact masks", check: (v: unknown) => expect(v).toBe("[REDACTED]") },
    { field: "internal", reason: "unspecified → redact (secure default)", check: (v: unknown) => expect(v).toBe("[REDACTED]") },
    { field: "legacy", reason: "legacy pii=true → redact", check: (v: unknown) => expect(v).toBe("[REDACTED]") },
  ])("$field: $reason", ({ field, check }) => {
    check(out[field]);
  });

  it("ssn: exclude deletes the key entirely (defence-in-depth)", () => {
    expect("ssn" in out).toBe(false);
  });
});

describe("redactPii — preservation invariants", () => {
  const table: TableConfig = {
    fields: {
      id: { select: "expose" },
      name: { select: "redact" },
      internal: {},
      legacy: { pii: true },
    },
  };

  it.each([
    { field: "name", value: null },
    { field: "internal", value: undefined },
    { field: "legacy", value: null },
  ])(
    "leaves null/undefined redact-field $field untouched (existence checks must still work)",
    ({ field, value }) => {
      const row = { id: 1, [field]: value } as Record<string, unknown>;
      const out = redactPii({ row, table });
      expect(out[field]).toBe(value);
    },
  );

  it.each(["name", "internal", "legacy"])(
    "skips redact-field %s entirely when absent from the row (no fabricated keys)",
    (field) => {
      const out = redactPii({ row: { id: 1 }, table });
      expect(field in out).toBe(false);
    },
  );

  it("does not mutate the input row", () => {
    const row = { id: 1, name: "Alice", internal: "y", legacy: "z" };
    const snapshot = { ...row };
    redactPii({ row, table });
    expect(row).toEqual(snapshot);
  });
});

/**
 * Safety matrix — exhaustively assert that any field that *should* be
 * masked is never returned raw, across every combination of (policy,
 * legacy fields, value type). Each row of the matrix is a specific
 * leak-failure scenario; adding a new policy state should add a row here
 * before touching production code.
 */
describe("redactPii — leak-prevention safety matrix", () => {
  const SECRET = "TOP_SECRET_VALUE";

  /** Every input shape we want to be defensive about. */
  const policyCases: Array<{
    label: string;
    info: SelectableFieldInfo;
    expected: "expose" | "redacted" | "deleted";
  }> = [
    // --- explicit select ---
    { label: "select=expose", info: { select: "expose" }, expected: "expose" },
    { label: "select=redact", info: { select: "redact" }, expected: "redacted" },
    { label: "select=exclude", info: { select: "exclude" }, expected: "deleted" },
    // --- unspecified = secure-by-default ---
    { label: "unspecified (no flags at all)", info: {}, expected: "redacted" },
    { label: "only note, no select", info: { note: "context" }, expected: "redacted" },
    // --- legacy aliases ---
    { label: "legacy pii=true", info: { pii: true }, expected: "redacted" },
    { label: "legacy pii=false", info: { pii: false }, expected: "redacted" },
    { label: "legacy piiReason without pii flag", info: { piiReason: "x" }, expected: "redacted" },
    // --- explicit + legacy together (explicit wins) ---
    { label: "select=expose + pii=true → expose wins (intent override)", info: { select: "expose", pii: true }, expected: "expose" },
    { label: "select=redact + pii=false → redact (matches anyway)", info: { select: "redact", pii: false }, expected: "redacted" },
    { label: "select=exclude + pii=true → exclude wins (strictest)", info: { select: "exclude", pii: true }, expected: "deleted" },
    { label: "select=redact + pii=true → redact (consistent)", info: { select: "redact", pii: true }, expected: "redacted" },
  ];

  it.each(policyCases)(
    "$label: secret value is never leaked",
    ({ info, expected }) => {
      const table: TableConfig = { fields: { field: info } };
      const out = redactPii({ row: { field: SECRET }, table });
      switch (expected) {
        case "expose":
          expect(out.field).toBe(SECRET);
          break;
        case "redacted":
          expect(out.field).toBe("[REDACTED]");
          expect(out.field).not.toBe(SECRET);
          break;
        case "deleted":
          expect("field" in out).toBe(false);
          // Also assert by stringify so a future bug returning a defaulted
          // empty string (e.g. via `out[name] = ""`) is caught.
          expect(JSON.stringify(out)).not.toContain(SECRET);
          break;
      }
    },
  );

  it.each([
    { label: "string", value: SECRET, expected: "[REDACTED]" },
    { label: "number", value: 42, expected: "[REDACTED]" },
    { label: "boolean true", value: true, expected: "[REDACTED]" },
    { label: "boolean false", value: false, expected: "[REDACTED]" },
    { label: "zero", value: 0, expected: "[REDACTED]" },
    { label: "empty string", value: "", expected: "[REDACTED]" },
    { label: "object", value: { nested: "secret" }, expected: "[REDACTED]" },
    { label: "array", value: ["a", "b"], expected: "[REDACTED]" },
    { label: "null (existence-preserve)", value: null, expected: null },
    { label: "undefined (existence-preserve)", value: undefined, expected: undefined },
  ])(
    "default policy redacts $label values (no type-based bypass)",
    ({ value, expected }) => {
      const table: TableConfig = { fields: { field: {} } };
      const out = redactPii({ row: { field: value }, table });
      expect(out.field).toEqual(expected);
    },
  );

  it("a typo'd policy string is rejected by TS at compile time, but at runtime falls through to redact (safe-fail)", () => {
    // Simulate a hand-edited JSON with a bogus `select` value. The TS type
    // forbids it, but a runtime parse of selectable-fields.json wouldn't —
    // so we want the unknown value to behave like the secure default.
    const table: TableConfig = {
      fields: { field: { select: "bogus" as unknown as "expose" } },
    };
    const out = redactPii({ row: { field: SECRET }, table });
    // The actual implementation passes 'bogus' through getEffectivePolicy
    // which returns `info.select` verbatim — anything not "expose" /
    // "exclude" hits the default redact branch. Verify the value doesn't
    // leak.
    expect(out.field).not.toBe(SECRET);
  });

  it("a row containing fields not declared in the table config is passed through unchanged (caller's responsibility)", () => {
    // Documented behavior: redactPii only walks declared fields. The
    // access-control layer is responsible for ensuring queries don't
    // SELECT undeclared columns in the first place; this test pins the
    // contract so a future refactor doesn't silently start stripping
    // (which would mask production data corruption symptoms).
    const table: TableConfig = { fields: { id: { select: "expose" } } };
    const out = redactPii({
      row: { id: 1, undeclared: "ok-to-leak-here" },
      table,
    });
    expect(out.undeclared).toBe("ok-to-leak-here");
  });

  it("two fields with different policies on the same row: each obeys its own policy", () => {
    const table: TableConfig = {
      fields: {
        public: { select: "expose" },
        private: { select: "redact" },
        secret: { select: "exclude" },
        defaulted: {},
      },
    };
    const out = redactPii({
      row: { public: "ok", private: "p", secret: "s", defaulted: "d" },
      table,
    });
    expect(out).toEqual({
      public: "ok",
      private: "[REDACTED]",
      defaulted: "[REDACTED]",
    });
    expect("secret" in out).toBe(false);
  });

  it("the literal SECRET never appears anywhere in the output object when policy is redact/exclude", () => {
    // Cross-cutting paranoia check: serialize the entire output and grep
    // for the secret. Catches accidental copy-through via a future "extra
    // metadata" field or similar.
    const table: TableConfig = {
      fields: {
        a: { select: "redact" },
        b: { select: "exclude" },
        c: {},
        d: { pii: true },
      },
    };
    const out = redactPii({
      row: { a: SECRET, b: SECRET, c: SECRET, d: SECRET },
      table,
    });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });
});

describe("redactPiiMany", () => {
  const table: TableConfig = {
    fields: {
      id: { select: "expose" },
      name: { select: "redact" },
    },
  };

  it("applies redactPii to every row", () => {
    const rows = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
    const out = redactPiiMany({ rows, table });
    expect(out).toEqual([
      { id: 1, name: "[REDACTED]" },
      { id: 2, name: "[REDACTED]" },
    ]);
  });

  it("returns an empty array when given an empty array", () => {
    expect(redactPiiMany({ rows: [], table })).toEqual([]);
  });
});
