import { describe, expect, it } from "vitest";
import { formatProblems, validateReport } from "../validate.js";
import { fullReport, minimalReport } from "./fixtures.js";

function problemsOf(input: unknown) {
  const result = validateReport({ input });
  if (result.ok) throw new Error("expected problems");
  return result.problems;
}

describe("validateReport", () => {
  it.each([
    ["full", fullReport()],
    ["minimal", minimalReport()],
  ])("accepts a %s report", (_name, input) => {
    const result = validateReport({ input });
    expect(result).toEqual({ ok: true, report: input });
  });

  it("returns every missing required field at once, each with its criterion", () => {
    expect(problemsOf({})).toEqual([
      { path: "title", message: "required" },
      { path: "conclusion", message: "required", criterion: "R1" },
      { path: "background", message: "required", criterion: "R7" },
      { path: "impact", message: "required", criterion: "R10" },
      { path: "claims", message: "required", criterion: "R2" },
      { path: "asks", message: "required; pass [] if nothing is needed from the reader", criterion: "R4" },
      { path: "decisions", message: "required; pass [] if you decided nothing on your own", criterion: "R8" },
    ]);
  });

  it("names each missing 5W1H field of an impact as R11", () => {
    const scope = [{ who: "a", what: "b", where: "d", why: "e" }];
    expect(problemsOf({ ...minimalReport(), impact: { ifLeft: "l", scope } })).toEqual([
      { path: "impact.scope[0].when", message: "required", criterion: "R11" },
      { path: "impact.scope[0].how", message: "required", criterion: "R11" },
    ]);
  });

  it("needs at least one target in the scope of the impact", () => {
    expect(problemsOf({ ...minimalReport(), impact: { ifLeft: "l", scope: [] } })).toEqual([
      { path: "impact.scope", message: "at least one target is required; say what the work reaches", criterion: "R10" },
    ]);
  });

  it("needs two options and a chosen one among them for each decision made", () => {
    const decision = { what: "w", options: [{ label: "a", pros: "p", cons: "c" }], chosen: { label: "a", reason: "r" } };
    expect(problemsOf({ ...minimalReport(), decisions: [decision] })).toEqual([
      {
        path: "decisions[0].options",
        message: "at least two options are required; a comparison needs an alternative",
        criterion: "R9",
      },
    ]);
    const options = [...decision.options, { label: "b", pros: "p", cons: "c" }];
    const strayed = { ...decision, options, chosen: { label: "z", reason: "r" } };
    expect(problemsOf({ ...minimalReport(), decisions: [strayed] })).toEqual([
      { path: "decisions[0].chosen.label", message: "must be the label of one of the options", criterion: "R8" },
    ]);
  });

  it("rejects a claim without evidence as R3", () => {
    const input = { ...minimalReport(), claims: [{ statement: "s", evidence: [] }] };
    expect(problemsOf(input)).toEqual([
      { path: "claims[0].evidence", message: "at least one evidence is required", criterion: "R3" },
    ]);
  });

  it("rejects an empty claims list", () => {
    expect(problemsOf({ ...minimalReport(), claims: [] })).toEqual([
      { path: "claims", message: "at least one claim is required", criterion: "R2" },
    ]);
  });

  it("treats whitespace as empty", () => {
    expect(problemsOf({ ...minimalReport(), title: "   " })).toEqual([
      { path: "title", message: "must not be empty" },
    ]);
  });

  it("needs two options for a decision", () => {
    const input = {
      ...minimalReport(),
      asks: [
        {
          kind: "decision",
          what: "w",
          options: [{ label: "a", pros: "p", cons: "c" }],
          recommendation: { label: "a", reason: "r" },
        },
      ],
    };
    expect(problemsOf(input)).toEqual([
      { path: "asks[0].options", message: "at least two options are required; a comparison needs an alternative", criterion: "R9" },
    ]);
  });

  it("needs the recommendation to name an option, alongside other problems", () => {
    const input = {
      ...minimalReport(),
      conclusion: "",
      asks: [
        {
          kind: "decision",
          what: "w",
          options: [
            { label: "a", pros: "p", cons: "c" },
            { label: "b", pros: "p", cons: "c" },
          ],
          recommendation: { label: "c", reason: "r" },
        },
      ],
    };
    expect(problemsOf(input)).toEqual([
      { path: "conclusion", message: "must not be empty", criterion: "R1" },
      { path: "asks[0].recommendation.label", message: "must be the label of one of the options", criterion: "R4" },
    ]);
  });

  it.each([["wish"], [undefined]])("rejects an ask whose kind is %j", (kind) => {
    expect(problemsOf({ ...minimalReport(), asks: [{ kind, what: "w" }] })).toEqual([
      { path: "asks[0].kind", message: 'must be "decision" or "action"', criterion: "R4" },
    ]);
  });

  it("requires an ask to act in 5W1H", () => {
    expect(problemsOf({ ...minimalReport(), asks: [{ kind: "action", what: "w" }] })).toEqual(
      ["who", "when", "where", "why", "how"].map((key) => ({ path: `asks[0].${key}`, message: "required", criterion: "R12" })),
    );
  });

  it("names each unknown field at its own path", () => {
    const report = minimalReport();
    const input = {
      ...report,
      summary: "s",
      claims: [{ ...report.claims[0], note: "n", details: "d" }],
    };
    const message = "not a field of the report; it would not reach the page";
    expect(problemsOf(input)).toEqual([
      { path: "claims[0].note", message, criterion: "R2" },
      { path: "claims[0].details", message, criterion: "R2" },
      { path: "summary", message },
    ]);
  });

  it.each([
    ["corrections", [{ said: "a", actually: "", why: "c" }], "corrections[0].actually", "R6"],
    ["changes", [{ what: "a", where: "w", before: "b" }], "changes[0].after", "R2"],
    ["changes", [{ what: "a", before: "b", after: "c" }], "changes[0].where", "R13"],
    ["remaining", [{ who: "a", what: "b", when: "c", where: "d", why: "e" }], "remaining[0].how", "R12"],
    ["asides", [{ note: "a", where: "w" }], "asides[0].cost", "R5"],
    ["asides", [{ note: "a", cost: "c" }], "asides[0].where", "R13"],
  ])("checks the fields of optional %s", (field, value, path, criterion) => {
    const [problem] = problemsOf({ ...minimalReport(), [field]: value });
    expect(problem).toMatchObject({ path, criterion });
  });

  it("names the input itself when it is not an object", () => {
    expect(problemsOf("text")).toEqual([{ path: "", message: "Expected object, received string" }]);
  });
});

describe("formatProblems", () => {
  it("writes one line per problem, with the criterion when there is one", () => {
    const text = formatProblems({
      problems: [
        { path: "title", message: "required" },
        { path: "claims[0].evidence", message: "at least one evidence is required", criterion: "R3" },
        { path: "", message: "Expected object, received string" },
      ],
    });
    expect(text).toBe(
      [
        "- title: required",
        "- claims[0].evidence: at least one evidence is required (R3)",
        "- (input): Expected object, received string",
      ].join("\n"),
    );
  });
});
