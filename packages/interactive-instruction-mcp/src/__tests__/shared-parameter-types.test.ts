/**
 * A parameter two actions share has to mean the same thing to both.
 *
 * `buildInputSchema` merges every handler's fields into the one `instruction`
 * tool, and it keeps the first declaration of each name:
 *
 *     if (!(key in merged)) merged[key] = value.optional();
 *
 * So when two handlers declare one name differently, callers are validated
 * against whichever handler happens to be registered first, and the other
 * handler's contract is a fiction. That is not hypothetical: `sizeExemption` was
 * added to `update` as `.nullable()` -- `null` being the documented way to remove
 * it -- and to `add` without, and `add` is registered first. Every unit test
 * passed, because a unit test calls the handler and its own schema; the call
 * `update(id, sizeExemption: null)` was rejected at the tool boundary with
 * "Expected string, received null".
 *
 * This compares the declarations by what they accept rather than by their types,
 * because that is what a caller experiences and it needs no knowledge of zod's
 * internals.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { HANDLERS } from "../tools/instruction/registry.js";

/** Values a caller could plausibly send, including the ones that caused this. */
const PROBES: { label: string; value: unknown }[] = [
  { label: "null", value: null },
  { label: "a string", value: "x" },
  { label: "an empty string", value: "" },
  { label: "a number", value: 1 },
  { label: "true", value: true },
  { label: "an empty array", value: [] },
  { label: "an array of strings", value: ["x"] },
  { label: "an object", value: {} },
];

function shapeOf(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> | null {
  let current: z.ZodTypeAny = schema;
  while (current instanceof z.ZodEffects) current = current.innerType() as z.ZodTypeAny;
  return current instanceof z.ZodObject ? (current.shape as Record<string, z.ZodTypeAny>) : null;
}

/** Every handler that declares each parameter name, apart from `action`. */
function declarationsByName(): Map<string, { action: string; field: z.ZodTypeAny }[]> {
  const byName = new Map<string, { action: string; field: z.ZodTypeAny }[]>();

  for (const handler of HANDLERS) {
    const shape = shapeOf(handler.schema as unknown as z.ZodTypeAny);
    if (shape === null) continue;
    for (const [name, field] of Object.entries(shape)) {
      if (name === "action") continue;
      const entries = byName.get(name) ?? [];
      entries.push({ action: handler.action, field });
      byName.set(name, entries);
    }
  }

  return byName;
}

const shared = [...declarationsByName()].filter(([, entries]) => entries.length > 1);

describe("a parameter declared by more than one action", () => {
  it("finds some, or this suite is checking nothing", () => {
    // `id`, `content`, `relatedDocs` and others are shared. If this ever hits
    // zero the merge stopped being the thing described above, and the rest of
    // this file is passing by default.
    expect(shared.length).toBeGreaterThan(0);
  });

  it.each(shared.map(([name, entries]) => ({ name, entries })))(
    "$name is accepted or rejected the same way by every action that takes it",
    ({ name, entries }) => {
      for (const probe of PROBES) {
        const verdicts = entries.map((entry) => ({
          action: entry.action,
          accepted: entry.field.safeParse(probe.value).success,
        }));

        const accepted = verdicts.filter((v) => v.accepted).map((v) => v.action);
        const rejected = verdicts.filter((v) => !v.accepted).map((v) => v.action);

        expect(
          accepted.length === 0 || rejected.length === 0,
          `\`${name}\` given ${probe.label}: accepted by ${accepted.join(", ") || "none"}; ` +
          `rejected by ${rejected.join(", ") || "none"}. ` +
          "The merged tool schema keeps whichever of these is registered first, so " +
          "the others are advertising a contract the tool will not honour. Declare " +
          "the field the same way in each, or give them different names."
        ).toBe(true);
      }
    }
  );
});
