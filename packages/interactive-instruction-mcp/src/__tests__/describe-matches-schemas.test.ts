/**
 * What `instruction_describe` promises, against what the schemas accept.
 *
 * The describe text is the only thing an agent reads before its first call,
 * and it is hand-written prose next to machine-checked schemas -- so it can
 * document a call the tool rejects outright, and nothing says so until someone
 * makes that call. That is what happened to `link_add` and `link_remove`:
 * both are gated and both require `explanation`, and both were documented
 * without it. Every example the tool gave for them failed validation.
 *
 * Found by running every action through `scripts/mcp-session.mjs`, which is
 * also why the check is here: a sweep finds it once, a test keeps it found.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { HANDLERS } from "../tools/instruction/registry.js";
import { buildDescribeText } from "../tools/instruction/index.js";
import type { ReminderConfig } from "../types/index.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

const describeText = buildDescribeText(config);

/** The parameters an action cannot be called without, `action` aside. */
function requiredParams(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.entries(schema.shape)
    .filter(([name, field]) => name !== "action" && !field.isOptional())
    .map(([name]) => name);
}

/** The lines of the describe text that show this action being called. */
function examplesFor(action: string): string[] {
  return describeText
    .split("\n")
    .filter((line) => line.includes(`action: "${action}"`));
}

/** Where a caller could learn a parameter exists at all. */
function mentions(params: { action: string; param: string; help: string }): boolean {
  const { action, param, help } = params;
  // `param + ":"`, not the bare name: `"provide"` contains `id`, so a bare
  // substring can never fail for the commonest parameter of all.
  return (
    examplesFor(action).some((line) => line.includes(`${param}:`)) || help.includes(`${param}:`)
  );
}

describe("instruction_describe", () => {
  it.each(HANDLERS.map((handler) => ({ action: handler.action })))(
    "shows at least one example of $action",
    ({ action }) => {
      expect(examplesFor(action).length).toBeGreaterThan(0);
    }
  );

  it.each(
    HANDLERS.flatMap((handler) =>
      requiredParams(handler.schema as z.ZodObject<z.ZodRawShape>).map((param) => ({
        action: handler.action,
        param,
      }))
    )
  )("documents $param, which $action cannot be called without", ({ action, param }) => {
    // At least one example, not every one: several actions have more than one
    // form, and a form that does not take the parameter is not wrong.
    const examples = examplesFor(action);

    expect(examples.some((line) => line.includes(`${param}:`))).toBe(true);
  });

  it.each(
    HANDLERS.flatMap((handler) =>
      Object.keys((handler.schema as z.ZodObject<z.ZodRawShape>).shape)
        .filter((param) => param !== "action")
        .map((param) => ({ action: handler.action, param, help: handler.help }))
    )
  )("mentions $action's $param somewhere a caller will read", ({ action, param, help }) => {
    // Not only the required ones. `add` took `relatedDocs` and `graph` took
    // `format` -- the only form of the graph an agent can actually read -- and
    // neither appeared in the describe text or the action's help, so the only
    // way to find them was to read the source.
    //
    // The help counts because it is what a validation failure prints back.
    expect(mentions({ action, param, help })).toBe(true);
  });
});

/**
 * Every example the server prints, wherever it prints it.
 *
 * The describe text is not the only place this server tells a caller how to
 * make a call. Each response ends in next actions, and those are examples too
 * -- `instruction(action: "link_add", id: "<doc-id>", relatedDocs: [...])`, in
 * three separate handlers, with the `explanation` the schema requires missing
 * from all three. Fixing the describe text left every one of them.
 *
 * So the check reads the source, because the examples are source text: template
 * literals in `help`, in `formatNextActions` calls, and in the describe block.
 * Anything that looks like a call gets its parameter names compared with what
 * the action cannot be called without.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const toolDir = join(import.meta.dirname, "../tools/instruction");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

interface Example {
  file: string;
  action: string;
  params: string[];
  text: string;
}

/** Every `instruction(action: "x", ...)` written anywhere in the tool's source. */
function examplesInSource(): Example[] {
  const found: Example[] = [];

  for (const file of sourceFiles(toolDir)) {
    // Whole file, not line by line: an example long enough to wrap is exactly
    // the one most likely to have lost an argument, and a per-line scan cannot
    // see it. `graph`'s help already wraps one.
    const source = readFileSync(file, "utf-8");

    for (const start of source.matchAll(/instruction\(action: \\?"([a-z_]+)\\?"/g)) {
      const args = argumentsFrom({ source, from: start.index + start[0].length });
      if (args === null) continue;

      // `instruction(action: "add", ...)` points at an action; it does not
      // claim to be a call. An ellipsis standing where arguments would go is
      // the difference between a reference and an example.
      if (/,\s*\.\.\.\s*$/.test(args)) continue;

      found.push({
        file: file.slice(toolDir.length + 1),
        action: start[1],
        params: parameterNames(args),
        text: `${start[0]}${args})`.replace(/\s+/g, " "),
      });
    }
  }

  return found;
}

/**
 * The argument text up to the `)` that closes the call.
 *
 * Counting parentheses rather than stopping at the first one: a value may well
 * contain a bracket, and treating that as the end of the call made a perfectly
 * valid example look like one missing half its arguments.
 */
export function argumentsFrom(params: { source: string; from: number }): string | null {
  const { source, from } = params;
  let depth = 0;

  let inString: string | null = null;

  for (let i = from; i < source.length; i++) {
    const char = source[i];

    // A backslash and whatever follows it are one unit, wherever they appear.
    // Handling escapes only inside strings broke the `\"` form the match
    // pattern above explicitly supports: the opening `\"` began a string whose
    // closing `\"` was then read as an escape, so the string never ended and
    // the whole example was skipped -- the scanner going blind while the suite
    // stayed green, which is the thing this file exists to prevent.
    if (char === "\\") {
      i++;
      continue;
    }

    // Parentheses inside a value are text. Counting them made an unbalanced
    // `(` in an example run the scan past the call's own `)` and report a
    // parameter list belonging to whatever came next.
    if (inString !== null) {
      if (char === inString) inString = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      continue;
    }

    if (char === "(") depth++;
    else if (char === ")") {
      if (depth === 0) return source.slice(from, i);
      depth--;
    } else if (char === "\n" && source.slice(from, i).trim() === "") return null;
  }

  return null;
}

/**
 * The parameter names in an argument list, ignoring anything inside a value.
 *
 * Without that, `content: "Usage: run it"` contributes a parameter called
 * `Usage`, which makes the extracted names untrustworthy for anything stricter
 * than "is the required one present".
 */
export function parameterNames(args: string): string[] {
  const outsideValues = args.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return [...outsideValues.matchAll(/([a-zA-Z]+):/g)].map((match) => match[1]);
}

describe("the examples this server prints", () => {
  const examples = examplesInSource();

  it("finds them, so a green run means something", () => {
    expect(examples.length).toBeGreaterThan(20);
  });

  it("only names actions that exist", () => {
    const actions = new Set(HANDLERS.map((handler) => handler.action));
    const unknown = examples.filter((example) => !actions.has(example.action));

    expect(unknown.map((e) => `${e.file}: ${e.text}`)).toEqual([]);
  });

  it("never shows a call the schema would reject", () => {
    const required = new Map(
      HANDLERS.map((handler) => [
        handler.action,
        requiredParams(handler.schema as z.ZodObject<z.ZodRawShape>),
      ])
    );

    const broken = examples.flatMap((example) => {
      const missing = (required.get(example.action) ?? []).filter(
        (param) => !example.params.includes(param)
      );
      return missing.length === 0 ? [] : [`${example.file}: ${example.text} (missing ${missing.join(", ")})`];
    });

    expect(broken).toEqual([]);
  });

  it("shows a real value where the schema accepts only a few", () => {
    // Names were checked; values were not. `set_status(status: "<status>")`
    // reads like every other placeholder here, and the schema is
    // `z.literal("editing")` -- so the documented call is rejected, which is
    // the class #62 was about. Where the schema fixes the set of values, the
    // example has to name one of them.
    const allowed = new Map<string, string[]>();
    for (const handler of HANDLERS) {
      for (const [name, field] of Object.entries((handler.schema as z.ZodObject<z.ZodRawShape>).shape)) {
        const inner = field instanceof z.ZodOptional ? (field.unwrap() as z.ZodTypeAny) : field;
        if (inner instanceof z.ZodLiteral && typeof inner.value === "string") {
          allowed.set(`${handler.action}.${name}`, [inner.value]);
        } else if (inner instanceof z.ZodEnum) {
          allowed.set(`${handler.action}.${name}`, inner.options as string[]);
        }
      }
    }

    const wrong: string[] = [];
    for (const example of examplesInSource()) {
      for (const [param, values] of allowed) {
        const [action, name] = param.split(".");
        if (action !== example.action || name === "action") continue;

        const shown = new RegExp(`${name}: "([^"]*)"`).exec(example.text);
        // `${...}` is filled in at runtime with whatever the caller passed, so
        // the literal in the source is not the value anyone sees.
        if (shown !== null && !shown[1].includes("${") && !values.includes(shown[1])) {
          wrong.push(`${example.file}: ${name}: "${shown[1]}" (allowed: ${values.join(", ")})`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });
});

/**
 * The scanner's own reader, on inputs this repository does not happen to
 * contain.
 *
 * Every property below was added in response to a real defect, and none of them
 * changed a single result when they were added -- the same 136 examples before
 * and after. So removing any of them would also change nothing, and the suite
 * would stay green while the scanner quietly stopped seeing things. These are
 * the fixtures that make that impossible.
 */
describe("argumentsFrom", () => {
  const read = (source: string): string | null =>
    argumentsFrom({ source, from: source.indexOf("(") + 1 });

  it("stops at the parenthesis that closes the call", () => {
    expect(read('f(a: "x")')).toBe('a: "x"');
  });

  it("spans lines, because a long example wraps", () => {
    // The line-bounded version missed exactly the examples most likely to have
    // lost an argument.
    expect(read('f(a: "x",\n  b: "y")')).toBe('a: "x",\n  b: "y"');
  });

  it("does not end the call at a parenthesis inside a value", () => {
    expect(read('f(a: "why (and how)", b: "y")')).toBe('a: "why (and how)", b: "y"');
  });

  it("survives an unbalanced parenthesis inside a value", () => {
    // Counting brackets in text ran the scan past the call and reported the
    // parameters of whatever came next.
    expect(read('f(a: "half (open", b: "y")')).toBe('a: "half (open", b: "y"');
  });

  it("reads the escaped-quote form the match pattern supports", () => {
    // An example written inside a plain double-quoted string. Treating a
    // backslash as an escape only within a string made the closing one swallow
    // the quote, so the string never closed and the example was skipped.
    expect(read('f(a: \\"x\\", b: \\"y\\")')).toBe('a: \\"x\\", b: \\"y\\"');
  });

  it("gives up rather than guessing when the call never closes", () => {
    expect(read("f(a: 1\n\n")).toBeNull();
  });
});

describe("parameterNames", () => {
  it("names the parameters", () => {
    expect(parameterNames('id: "x", content: "y"')).toEqual(["id", "content"]);
  });

  it("ignores what looks like a parameter inside a value", () => {
    // `content: "Usage: run it"` used to contribute a parameter called `Usage`.
    expect(parameterNames('content: "Usage: run it", id: "https://x/y"')).toEqual(["content", "id"]);
  });
});

