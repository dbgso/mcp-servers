import { describe, it, expect, vi } from "vitest";
import {
  emitLegacySelectableFieldsNudgeIfAny,
  formatLegacySelectableFieldsNudge,
} from "../server.js";
import type { LegacyUsageReport } from "mcp-shared-db-core";
import type { SelectableFieldsMap } from "mcp-shared-db";

describe("formatLegacySelectableFieldsNudge", () => {
  it("returns null when the report has no legacy usage", () => {
    const report: LegacyUsageReport = { entries: [], hasLegacyUsage: false };
    expect(
      formatLegacySelectableFieldsNudge({ report, filePath: "/tmp/sf.json" }),
    ).toBeNull();
  });

  it("includes the file path so operators can find the file to edit", () => {
    const report: LegacyUsageReport = {
      hasLegacyUsage: true,
      entries: [{ table: "users", field: "name", kind: "pii" }],
    };
    const msg = formatLegacySelectableFieldsNudge({
      report,
      filePath: "/etc/myapp/sf.json",
    });
    expect(msg).toContain("/etc/myapp/sf.json");
  });

  it("names every legacy site (table.field + kind) on its own line", () => {
    const report: LegacyUsageReport = {
      hasLegacyUsage: true,
      entries: [
        { table: "users", field: "name", kind: "pii" },
        { table: "users", field: "name", kind: "piiReason" },
        { table: "orders", field: "email", kind: "pii" },
      ],
    };
    const msg = formatLegacySelectableFieldsNudge({ report, filePath: "/tmp/sf.json" });
    expect(msg).toContain("  - users.name (pii)");
    expect(msg).toContain("  - users.name (piiReason)");
    expect(msg).toContain("  - orders.email (pii)");
  });

  it("mentions the new select shape in the suggestion line", () => {
    const report: LegacyUsageReport = {
      hasLegacyUsage: true,
      entries: [{ table: "users", field: "name", kind: "pii" }],
    };
    const msg = formatLegacySelectableFieldsNudge({ report, filePath: "/tmp/sf.json" });
    expect(msg).toMatch(/select.*redact.*expose.*exclude/);
  });

  it("calls back-compat out so operators know they don't have to fix immediately", () => {
    const report: LegacyUsageReport = {
      hasLegacyUsage: true,
      entries: [{ table: "users", field: "name", kind: "pii" }],
    };
    const msg = formatLegacySelectableFieldsNudge({ report, filePath: "/tmp/sf.json" });
    expect(msg).toMatch(/back-compat|still/i);
  });

  it("truncates long lists with a (+N more) suffix instead of flooding stderr", () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      table: "t",
      field: `f${i}`,
      kind: "pii" as const,
    }));
    const report: LegacyUsageReport = { hasLegacyUsage: true, entries };
    const msg = formatLegacySelectableFieldsNudge({ report, filePath: "/tmp/sf.json" }) ?? "";
    // 20 shown + 1 "(+5 more)" line
    expect(msg).toContain("  - t.f0 (pii)");
    expect(msg).toContain("  - t.f19 (pii)");
    expect(msg).not.toContain("  - t.f20 (pii)");
    expect(msg).toContain("(+5 more)");
  });
});

describe("emitLegacySelectableFieldsNudgeIfAny", () => {
  it("does not call the logger when the map is fully migrated", () => {
    const log = vi.fn();
    const selectableFields: SelectableFieldsMap = {
      users: { fields: { id: { select: "expose" }, name: { select: "redact" } } },
    };
    emitLegacySelectableFieldsNudgeIfAny({
      selectableFields,
      filePath: "/tmp/sf.json",
      log,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("calls the logger exactly once with a single multi-line message", () => {
    const log = vi.fn();
    const selectableFields: SelectableFieldsMap = {
      users: { fields: { name: { pii: true, piiReason: "real name" } } },
    };
    emitLegacySelectableFieldsNudgeIfAny({
      selectableFields,
      filePath: "/tmp/sf.json",
      log,
    });
    expect(log).toHaveBeenCalledTimes(1);
    const msg = log.mock.calls[0]?.[0] as string;
    expect(msg).toContain("/tmp/sf.json");
    expect(msg).toContain("users.name (pii)");
    expect(msg).toContain("users.name (piiReason)");
  });

  it("defaults to console.error when no logger is injected", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const selectableFields: SelectableFieldsMap = {
        users: { fields: { name: { pii: true } } },
      };
      emitLegacySelectableFieldsNudgeIfAny({
        selectableFields,
        filePath: "/tmp/sf.json",
      });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
