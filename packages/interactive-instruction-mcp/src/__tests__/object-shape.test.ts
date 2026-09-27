/**
 * The unwrapping that lets an action state a condition between its arguments.
 *
 * `buildInputSchema` merges every handler's fields into the one `instruction`
 * tool. It used to read `.shape` directly, so a handler that wanted `.refine`
 * -- "`set_status` needs one of `id` or `ids`" -- would have contributed no
 * fields at all, and the design note recorded that as "cannot be expressed in
 * the schema". It can: the wrapper keeps what it wraps.
 *
 * The schemas below are illustrations, not a handler's own: the one this was
 * written about, `list(backlinks:)`, turned out not to want a refinement at all
 * -- it wanted to be its own action, where `id` is plainly required.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { objectShape } from "../tools/instruction/index.js";

const base = z.object({
  action: z.literal("list"),
  id: z.string().optional(),
  backlinks: z.boolean().optional(),
});

describe("objectShape", () => {
  it("returns the fields of a plain object", () => {
    expect(Object.keys(objectShape(base) ?? {})).toEqual(["action", "id", "backlinks"]);
  });

  it("returns the fields through a refinement", () => {
    const refined = base.refine((v) => !(v.backlinks === true && v.id === undefined));
    expect(Object.keys(objectShape(refined) ?? {})).toEqual(["action", "id", "backlinks"]);
  });

  it("returns the fields through refinements applied more than once", () => {
    const refined = base
      .refine((v) => !(v.backlinks === true && v.id === undefined))
      .refine((v) => v.action === "list");
    expect(Object.keys(objectShape(refined) ?? {})).toEqual(["action", "id", "backlinks"]);
  });

  it("leaves the refinement in force, so it is enforced at dispatch", () => {
    const refined = base.refine((v) => !(v.backlinks === true && v.id === undefined), {
      message: "`backlinks: true` needs `id`",
    });

    expect(refined.safeParse({ action: "list", backlinks: true }).success).toBe(false);
    expect(refined.safeParse({ action: "list", id: "doc", backlinks: true }).success).toBe(true);
  });

  it("returns null for a schema that is not an object, rather than a broken shape", () => {
    // `buildInputSchema` skips such a handler instead of spreading `undefined`
    // over the merged schema.
    expect(objectShape(z.string())).toBeNull();
    expect(objectShape(z.string().refine(() => true))).toBeNull();
  });
});
