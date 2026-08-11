import { describe, it, expect } from "vitest";
import { formatSelectableFieldsJson } from "../format/selectable-fields-json.js";
import type { RawTableMetadata } from "../introspect/types.js";

const table: RawTableMetadata = {
  schema: "public",
  name: "users",
  description: "App users",
  primaryKey: ["id"],
  columns: [
    { name: "id", nativeType: "int4", type: "number", nullable: false },
    { name: "email", nativeType: "varchar(255)", type: "string", nullable: false },
    { name: "weird-key", nativeType: "text", type: "string", nullable: true },
  ],
  indexes: [],
  foreignKeys: [],
};

function parseFormatted(tables: RawTableMetadata[]): Record<string, unknown> {
  return JSON.parse(formatSelectableFieldsJson(tables));
}

describe("formatSelectableFieldsJson", () => {
  it("emits parseable JSON keyed by table name", () => {
    const data = parseFormatted([table]) as Record<
      string,
      { fields: Record<string, unknown>; description?: string }
    >;
    expect(Object.keys(data)).toEqual(["users"]);
    expect(data.users.description).toBe("App users");
  });

  it.each(["id", "email", "weird-key"])(
    'every generated field starts as { "select": "redact" } (secure-by-default): %s',
    (col) => {
      const data = parseFormatted([table]) as {
        users: { fields: Record<string, Record<string, unknown>> };
      };
      expect(data.users.fields[col]).toEqual({ select: "redact" });
    },
  );

  it("never auto-marks a field with the legacy pii flag (operator must hand-edit)", () => {
    expect(formatSelectableFieldsJson([table])).not.toContain('"pii"');
  });

  it('never auto-marks a field with "expose" — that requires a deliberate hand-edit', () => {
    expect(formatSelectableFieldsJson([table])).not.toContain('"expose"');
  });

  it("omits description when not set on the table", () => {
    const noDesc: RawTableMetadata = { ...table };
    delete noDesc.description;
    const data = parseFormatted([noDesc]) as Record<string, Record<string, unknown>>;
    expect("description" in data.users).toBe(false);
  });

  it("ends with a trailing newline so files are POSIX-clean", () => {
    expect(formatSelectableFieldsJson([table]).endsWith("\n")).toBe(true);
  });

  it("handles empty input as an empty object", () => {
    expect(parseFormatted([])).toEqual({});
  });
});
