/**
 * The one hazard of putting every action behind a single tool.
 *
 * The MCP SDK forces `additionalProperties: false`, so the tool declares the
 * union of every action's fields -- and a name declared twice can only be
 * declared once. The merge keeps the first, silently, and every other action's
 * use of that name is then validated against a type it was never meant to have.
 *
 * It happened here: `start.args` is the server's argv (a string array) and
 * `call.args` was the tool's arguments (an object), so every `call` with
 * arguments was rejected by the outer schema before the session ever saw it.
 * The second one is `params` now, and this keeps it that way.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { HANDLERS } from "../tools/lab/registry.js";

/** What kind of thing a field is, at the resolution the merge cares about. */
function kindOf(field: z.ZodTypeAny): string {
  const unwrapped = field instanceof z.ZodOptional ? (field.unwrap() as z.ZodTypeAny) : field;
  return unwrapped._def.typeName as string;
}

function fieldsOf(handler: (typeof HANDLERS)[number]): [string, z.ZodTypeAny][] {
  const shape = (handler.schema as unknown as z.ZodObject<Record<string, z.ZodTypeAny>>).shape;
  return Object.entries(shape).filter(([name]) => name !== "action");
}

describe("the merged input schema", () => {
  it("never gives one field name two meanings", () => {
    const kinds = new Map<string, Map<string, string[]>>();

    for (const handler of HANDLERS) {
      for (const [name, field] of fieldsOf(handler)) {
        const byKind = kinds.get(name) ?? new Map<string, string[]>();
        const actions = byKind.get(kindOf(field)) ?? [];
        byKind.set(kindOf(field), [...actions, handler.action]);
        kinds.set(name, byKind);
      }
    }

    const conflicts = [...kinds.entries()]
      .filter(([, byKind]) => byKind.size > 1)
      .map(([name, byKind]) => `${name}: ${[...byKind].map(([kind, actions]) => `${kind} (${actions.join(", ")})`).join(" vs ")}`);

    expect(conflicts).toEqual([]);
  });

  it("declares every field some action takes", () => {
    // A field the tool does not declare cannot reach a handler at all: the SDK
    // rejects the call before dispatch.
    const declared = new Set(Object.keys(buildMergedShape()));

    for (const handler of HANDLERS) {
      for (const [name] of fieldsOf(handler)) {
        expect(declared, `${handler.action}.${name}`).toContain(name);
      }
    }
  });
});

/** The same merge the tool registration performs, over the same handlers. */
function buildMergedShape(): Record<string, z.ZodTypeAny> {
  const merged: Record<string, z.ZodTypeAny> = { action: z.string().optional() };
  for (const handler of HANDLERS) {
    for (const [name, field] of fieldsOf(handler)) {
      if (!(name in merged)) merged[name] = field.optional();
    }
  }
  return merged;
}
