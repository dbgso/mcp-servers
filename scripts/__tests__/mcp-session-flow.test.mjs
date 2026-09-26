import { describe, it, expect } from "vitest";
import {
  checkExpectations,
  formatFailure,
  parseArgs,
  parseEnvAssignment,
  parseFlow,
  responseText,
  substitute,
} from "../lib/mcp-session-flow.mjs";

function callStep(overrides = {}) {
  return { kind: "call", line: 1, tool: "t", args: {}, label: "t", expect: [], expectNot: [], ...overrides };
}

describe("parseFlow", () => {
  it("reads one step per line", () => {
    const { steps, errors } = parseFlow(
      '{"call": "instruction", "args": {"action": "list"}}\n{"call": "instruction", "args": {"action": "lint"}}\n'
    );

    expect(errors).toEqual([]);
    expect(steps.map((s) => s.args.action)).toEqual(["list", "lint"]);
  });

  it.each([
    { name: "a blank line", text: "\n\n" },
    { name: "a comment", text: "# why this flow exists\n" },
    { name: "an indented comment", text: "   # still a comment\n" },
  ])("skips $name", ({ text }) => {
    expect(parseFlow(text).steps).toEqual([]);
  });

  it("keeps the line number, so an error points at the file", () => {
    const { errors } = parseFlow('\n# note\n{"call": "ok"}\nnot json\n');

    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(4);
    expect(errors[0].message).toContain("not JSON");
  });

  it.each([
    { name: "an array", line: "[1, 2]", message: "must be a JSON object" },
    { name: "a bare string", line: '"hello"', message: "must be a JSON object" },
    { name: "null", line: "null", message: "must be a JSON object" },
    { name: "no call", line: '{"args": {}}', message: "needs `call:" },
    { name: "an empty call", line: '{"call": ""}', message: "needs `call:" },
    { name: "args that are not an object", line: '{"call": "t", "args": [1]}', message: "`args` must be a JSON object" },
  ])("rejects $name", ({ line, message }) => {
    const { steps, errors } = parseFlow(`${line}\n`);

    expect(steps).toEqual([]);
    expect(errors[0].message).toContain(message);
  });

  it("defaults args to an empty object and the label to the tool name", () => {
    const [step] = parseFlow('{"call": "instruction"}\n').steps;

    expect(step.args).toEqual({});
    expect(step.label).toBe("instruction");
  });

  it.each([
    { name: "a single string", written: '"one"', parsed: ["one"] },
    { name: "a list", written: '["one", "two"]', parsed: ["one", "two"] },
    { name: "nothing", written: undefined, parsed: [] },
  ])("takes expectations as $name", ({ written, parsed }) => {
    const line = written === undefined ? '{"call": "t"}' : `{"call": "t", "expect": ${written}}`;

    expect(parseFlow(`${line}\n`).steps[0].expect).toEqual(parsed);
  });

  it("recognises a tools listing", () => {
    const [step] = parseFlow('{"tools": true}\n').steps;

    expect(step.kind).toBe("tools");
  });
});

describe("substitute", () => {
  const vars = { TMPDIR: "/tmp/run-1" };

  it.each([
    { name: "a bare token", value: "{{TMPDIR}}", expected: "/tmp/run-1" },
    { name: "a token inside a path", value: "{{TMPDIR}}/docs", expected: "/tmp/run-1/docs" },
    { name: "the same token twice", value: "{{TMPDIR}}:{{TMPDIR}}", expected: "/tmp/run-1:/tmp/run-1" },
  ])("expands $name", ({ value, expected }) => {
    expect(substitute({ value, vars })).toBe(expected);
  });

  it("leaves an unknown token alone rather than emitting `undefined`", () => {
    // A silent `undefined` in a path is how a run ends up writing to
    // `/undefined/docs` and reporting success.
    expect(substitute({ value: "{{NOPE}}", vars })).toBe("{{NOPE}}");
  });

  it("reaches into arrays and nested objects", () => {
    const value = { dir: "{{TMPDIR}}", args: ["--out", "{{TMPDIR}}/x"], deep: { at: "{{TMPDIR}}" } };

    expect(substitute({ value, vars })).toEqual({
      dir: "/tmp/run-1",
      args: ["--out", "/tmp/run-1/x"],
      deep: { at: "/tmp/run-1" },
    });
  });

  it.each([
    { name: "a number", value: 42 },
    { name: "a boolean", value: true },
    { name: "null", value: null },
  ])("passes $name through untouched", ({ value }) => {
    expect(substitute({ value, vars })).toBe(value);
  });
});

describe("checkExpectations", () => {
  it("passes when every expectation is met", () => {
    const step = callStep({ expect: ["created", "successfully"], expectNot: ["refused"] });

    expect(checkExpectations({ step, text: "Draft created successfully." })).toEqual([]);
  });

  it("reports what was missing, with the line it was asked for on", () => {
    const step = callStep({ line: 7, expect: ["promoted"] });

    const [failure] = checkExpectations({ step, text: "Not Yet" });
    expect(failure).toEqual({ kind: "expect", line: 7, expected: "promoted" });
  });

  it("reports text that should have been absent", () => {
    const step = callStep({ line: 3, expectNot: ["selfReviewNotes"] });

    const [failure] = checkExpectations({ step, text: "selfReviewNotes: reviewed" });
    expect(failure).toEqual({ kind: "expectNot", line: 3, expected: "selfReviewNotes" });
  });

  it("collects every failure rather than stopping at the first", () => {
    const step = callStep({ expect: ["a", "b"], expectNot: ["c"] });

    expect(checkExpectations({ step, text: "c" })).toHaveLength(3);
  });
});

describe("responseText", () => {
  it("joins every content part", () => {
    expect(responseText({ content: [{ text: "one" }, { text: "two" }] })).toBe("one\ntwo");
  });

  it.each([
    { name: "no content", result: {} },
    { name: "content that is not a list", result: { content: "text" } },
    { name: "nothing at all", result: undefined },
  ])("returns an empty string for $name", ({ result }) => {
    expect(responseText(result)).toBe("");
  });

  it("survives a part with no text", () => {
    expect(responseText({ content: [{ type: "image" }, { text: "caption" }] })).toBe("\ncaption");
  });
});

describe("formatFailure", () => {
  it.each([
    { failure: { kind: "expect", line: 2, expected: "x" }, wording: "expected but missing" },
    { failure: { kind: "expectNot", line: 2, expected: "x" }, wording: "expected to be absent" },
  ])("names what went wrong for $failure.kind", ({ failure, wording }) => {
    const line = formatFailure(failure);

    expect(line).toContain(wording);
    expect(line).toContain("line 2");
  });
});

describe("parseEnvAssignment", () => {
  it("splits at the first `=`, so a value may contain one", () => {
    expect(parseEnvAssignment("URL=https://x/?a=b")).toEqual({ name: "URL", value: "https://x/?a=b" });
  });

  it("accepts an empty value", () => {
    expect(parseEnvAssignment("QUIET=")).toEqual({ name: "QUIET", value: "" });
  });

  it.each(["no-equals", "=novalue"])("rejects %o", (assignment) => {
    expect(parseEnvAssignment(assignment).error).toBeDefined();
  });
});

describe("parseArgs", () => {
  it("takes the package and the flow", () => {
    const parsed = parseArgs(["iimcp", "flow.jsonl"]);

    expect(parsed).toMatchObject({ package: "iimcp", flowPath: "flow.jsonl", serverArgs: [], keep: false, quiet: false });
  });

  it("sends everything after `--` to the server, not to the runner", () => {
    // Including things that look like this script's own options: the server's
    // arguments are the server's business.
    const parsed = parseArgs(["p", "f", "--", "/docs", "--exclude", "chain", "--keep"]);

    expect(parsed.serverArgs).toEqual(["/docs", "--exclude", "chain", "--keep"]);
    expect(parsed.keep).toBe(false);
  });

  it("collects repeated --env", () => {
    const parsed = parseArgs(["p", "f", "--env", "A=1", "--env", "B=2"]);

    expect(parsed.env).toEqual({ A: "1", B: "2" });
  });

  it.each([
    { argv: ["p"], message: "usage:" },
    { argv: [], message: "usage:" },
    { argv: ["p", "f", "--env"], message: "--env needs" },
    { argv: ["p", "f", "--env", "bare"], message: "--env needs" },
    { argv: ["p", "f", "--nope"], message: "unknown option" },
  ])("rejects $argv", ({ argv, message }) => {
    expect(parseArgs(argv).error).toContain(message);
  });

  it.each([
    { flag: "--keep", field: "keep" },
    { flag: "--quiet", field: "quiet" },
  ])("recognises $flag", ({ flag, field }) => {
    expect(parseArgs(["p", "f", flag])[field]).toBe(true);
  });
});
