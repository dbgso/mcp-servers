import { describe, it, expect } from "vitest";
import { detectLegacySelectableFieldsUsage } from "../legacy-detector.js";
import type { SelectableFieldsMap } from "../selectable-fields.js";

describe("detectLegacySelectableFieldsUsage", () => {
  it("returns an empty report when the map is fully migrated", () => {
    const map: SelectableFieldsMap = {
      users: {
        fields: {
          id: { select: "expose" },
          name: { select: "redact", note: "real name" },
        },
      },
    };
    const r = detectLegacySelectableFieldsUsage(map);
    expect(r.hasLegacyUsage).toBe(false);
    expect(r.entries).toEqual([]);
  });

  it("returns an empty report when the map is empty", () => {
    expect(detectLegacySelectableFieldsUsage({})).toEqual({
      entries: [],
      hasLegacyUsage: false,
    });
  });

  it("reports `pii: true` as a legacy site", () => {
    const map: SelectableFieldsMap = {
      users: { fields: { name: { pii: true } } },
    };
    const r = detectLegacySelectableFieldsUsage(map);
    expect(r.hasLegacyUsage).toBe(true);
    expect(r.entries).toEqual([{ table: "users", field: "name", kind: "pii" }]);
  });

  it("reports `pii: false` as a legacy site too (presence is the signal, not value)", () => {
    const map: SelectableFieldsMap = {
      users: { fields: { id: { pii: false } } },
    };
    const r = detectLegacySelectableFieldsUsage(map);
    expect(r.entries).toEqual([{ table: "users", field: "id", kind: "pii" }]);
  });

  it("reports `piiReason` as its own legacy site", () => {
    const map: SelectableFieldsMap = {
      users: { fields: { name: { piiReason: "real name" } } },
    };
    const r = detectLegacySelectableFieldsUsage(map);
    expect(r.entries).toEqual([
      { table: "users", field: "name", kind: "piiReason" },
    ]);
  });

  it("emits one entry per legacy field on a single site", () => {
    const map: SelectableFieldsMap = {
      users: { fields: { name: { pii: true, piiReason: "real name" } } },
    };
    const r = detectLegacySelectableFieldsUsage(map);
    expect(r.entries).toEqual([
      { table: "users", field: "name", kind: "pii" },
      { table: "users", field: "name", kind: "piiReason" },
    ]);
  });

  it("walks every table and field in declaration order", () => {
    const map: SelectableFieldsMap = {
      users: {
        fields: {
          id: { select: "expose" },
          name: { pii: true, piiReason: "real name" },
        },
      },
      orders: {
        fields: {
          id: { select: "expose" },
          customer_email: { pii: true },
        },
      },
    };
    const r = detectLegacySelectableFieldsUsage(map);
    expect(r.entries).toEqual([
      { table: "users", field: "name", kind: "pii" },
      { table: "users", field: "name", kind: "piiReason" },
      { table: "orders", field: "customer_email", kind: "pii" },
    ]);
  });

  it("treats new `note` (without legacy fields) as fully migrated", () => {
    const map: SelectableFieldsMap = {
      users: {
        fields: {
          name: { select: "redact", note: "real name" },
        },
      },
    };
    expect(detectLegacySelectableFieldsUsage(map).hasLegacyUsage).toBe(false);
  });
});
