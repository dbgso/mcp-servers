import { describe, it, expect } from "vitest";
import {
  blockersAndRisks,
  bulletSection,
  isTaskPhase,
  phaseSections,
  renderSections,
  STATUS_STYLE,
  statusLookup,
} from "../services/task-presentation.js";
import { TASK_PHASES } from "../types/index.js";
import type { TaskOutput } from "../types/index.js";

const output: TaskOutput = {
  what: "what",
  why: "why",
  how: "how",
  blockers: [],
  risks: [],
  phase: "plan",
  references_used: [],
  references_reason: "",
};

describe("phaseSections", () => {
  it.each([
    ["plan", ["Findings", "Sources"]],
    ["do", ["Changes", "Design Decisions"]],
    ["check", ["Test Target", "Test Results", "Coverage"]],
    ["act", ["Changes", "Feedback Addressed"]],
  ])("gives a %s output its sections", (phase, headings) => {
    const sections = phaseSections({ ...output, phase });

    expect(sections.map((s) => s.heading)).toEqual(headings);
  });

  it("has a section list for every phase a task is split into", () => {
    for (const phase of TASK_PHASES) {
      expect(phaseSections({ ...output, phase }).length).toBeGreaterThan(0);
    }
  });

  it.each(["research", "implement", "verify", "fix", ""])("gives an unknown phase %j none", (phase) => {
    expect(isTaskPhase(phase)).toBe(false);
    expect(phaseSections({ ...output, phase })).toEqual([]);
  });
});

describe("renderSections", () => {
  it("renders each section under a heading of the given level", () => {
    const text = renderSections({
      sections: [
        { heading: "A", body: "one" },
        { heading: "B", body: "two" },
      ],
      level: 3,
    });

    expect(text).toBe("### A\none\n\n### B\ntwo");
  });
});

describe("statusLookup", () => {
  it("looks a known status up", () => {
    expect(statusLookup({ table: STATUS_STYLE, status: "self_review" })).toBe(STATUS_STYLE.self_review);
  });

  it.each(["ready", "toString", ""])("shows an unknown status %j as pending", (status) => {
    expect(statusLookup({ table: STATUS_STYLE, status })).toBe(STATUS_STYLE.pending);
  });
});

describe("bulletSection", () => {
  it("lists each item as a bullet", () => {
    expect(bulletSection({ title: "Risks", items: ["a", "b"] })).toEqual({
      heading: "Risks",
      body: "- a\n- b",
    });
  });

  it.each([
    ["an empty list", []],
    ["a missing list", undefined],
  ])("says - None for %s", (_label, items) => {
    expect(bulletSection({ title: "Risks", items })).toEqual({ heading: "Risks", body: "- None" });
  });

  it("renders Blockers then Risks at the level asked", () => {
    const text = renderSections({ sections: blockersAndRisks({ blockers: ["x"], risks: [] }), level: 3 });
    expect(text).toBe("### Blockers\n- x\n\n### Risks\n- None");
  });
});
