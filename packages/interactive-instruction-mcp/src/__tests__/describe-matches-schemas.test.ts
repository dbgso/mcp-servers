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
});
