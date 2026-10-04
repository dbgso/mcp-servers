import { describe, it, expect } from "vitest";
import { toolListLines } from "../tools/lab/types.js";

describe("toolListLines", () => {
  it("gives one line per tool, with an empty description for a tool that has none", () => {
    expect(toolListLines([{ name: "a", description: "does a" }, { name: "b" }])).toEqual([
      "- **a** — does a",
      "- **b** — ",
    ]);
  });
});
