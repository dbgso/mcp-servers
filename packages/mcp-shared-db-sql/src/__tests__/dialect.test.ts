import { describe, expect, it } from "vitest";
import { noExplainPlan } from "../dialect.js";

describe("noExplainPlan", () => {
  it("reports no estimate and keeps the raw rows for debugging", () => {
    const raw = [{ unexpected: true }];

    expect(noExplainPlan(raw)).toEqual({
      estimatedRows: null,
      totalCost: null,
      planSummary: "(no plan returned)",
      raw,
    });
  });
});
