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
  return (
    examplesFor(action).some((line) => line.includes(`${param}:`)) || help.includes(param)
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
    for (const line of readFileSync(file, "utf-8").split("\n")) {
      // Examples are written on one line, and the call ends at the first `)`
      // that is not inside the arguments -- good enough for a literal.
      const matches = line.matchAll(/instruction\(action: \\?"([a-z_]+)\\?"([^)]*)\)/g);
      for (const match of matches) {
        // `instruction(action: "add", ...)` points at an action; it does not
        // claim to be a call. An ellipsis standing where arguments would go is
        // the difference between a reference and an example.
        if (/,\s*\.\.\.\s*$/.test(match[2])) continue;
        found.push({
          file: file.slice(toolDir.length + 1),
          action: match[1],
          params: [...match[2].matchAll(/([a-zA-Z]+):/g)].map((p) => p[1]),
          text: match[0],
        });
      }
    }
  }

  return found;
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
});
