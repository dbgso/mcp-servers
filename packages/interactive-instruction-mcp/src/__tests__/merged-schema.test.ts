/**
 * What the one published schema says about parameters several actions declare.
 *
 * `instruction` advertises a single schema assembled from sixteen handlers, and
 * the assembly used to keep the first declaration of each name and drop the rest.
 * Two things were untrue because of it:
 *
 * - `sizeExemption` was nullable on `update` and not on `add`, and `add` is
 *   registered first, so `update(id, sizeExemption: null)` -- the documented way
 *   to remove the field -- was rejected at the tool boundary while every unit
 *   test passed, because a unit test validates against the handler's own schema.
 * - `id` is the document to act on for fifteen actions and the category to list
 *   inside for `list`, and `list` is registered first, so the tool advertised
 *   "Parent ID to list documents under" as its meaning for all of them.
 *
 * The first is refused now instead of resolved, and the second is not guessed at.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildInputSchemaForTesting, resolveField } from "../tools/instruction/index.js";

const schema = buildInputSchemaForTesting();

describe("the merged schema", () => {
  it("keeps every field optional, whatever the actions require", () => {
    // A field `add` requires cannot be required of the tool that also serves
    // `list`. The requirement is enforced by the handler's own schema on
    // dispatch; this is what the caller is shown.
    for (const [name, field] of Object.entries(schema)) {
      expect(field.safeParse(undefined).success, `${name} should accept undefined`).toBe(true);
    }
  });

  it("says which actions take a shared parameter", () => {
    expect(schema.ids.description).toContain("Taken by: approve, set_status");
  });

  it("says where a shared parameter is required", () => {
    expect(schema.content.description).toContain("Required in: add");
  });

  it("names the one action a private parameter belongs to", () => {
    // `newId` has no description of its own, and "Only `rename` takes this" is
    // more than the empty string it used to advertise.
    expect(schema.newId.description).toBe("Only `rename` takes this.");
  });

  it("does not present one action's wording as the meaning for all of them", () => {
    // The whole of the `id` complaint. Fifteen actions, two meanings, and the
    // description used to be whichever one was registered first.
    expect(schema.id.description).not.toContain("Parent ID to list documents under");
    expect(schema.id.description).toContain("Taken by:");
    expect(schema.id.description).toContain("instruction_describe()");
  });

  it("keeps the wording when every action that takes the name agrees on it", () => {
    // Dropping it whenever a name is shared would lose something true. `ids` is
    // declared the same way by both actions that take it.
    expect(schema.ids.description).toContain("Comma-separated draft IDs");
  });

  it("leaves `action` optional, because a bare call is the way to list them", () => {
    // `registerTool` publishes `required`, unlike the overload it replaced, so
    // marking this would have the SDK refuse the call the tool's own description
    // invites.
    expect(schema.action.safeParse(undefined).success).toBe(true);
  });
});

/**
 * The refusal, which the real registry cannot exercise.
 *
 * Nothing in the package declares a name two ways any more, so a guard tested
 * only against the registry would pass whether or not it worked. These hand a
 * disagreeing pair straight to the resolver.
 */
describe("a name two actions declare differently", () => {
  const declaration = (action: string, field: z.ZodTypeAny) => ({
    action,
    field,
    required: !field.safeParse(undefined).success,
  });

  it("is refused, naming both actions", () => {
    // The pair from #69: nullable on one, not on the other, so `null` was
    // rejected at the tool boundary while the handler accepted it.
    expect(() =>
      resolveField({
        name: "sizeExemption",
        declarations: [
          declaration("add", z.string().optional()),
          declaration("update", z.string().nullable().optional()),
        ],
      })
    ).toThrow(/declared differently by add and update/);
  });

  it("says what would otherwise happen, not just that it is wrong", () => {
    let message = "";
    try {
      resolveField({
        name: "force",
        declarations: [declaration("a", z.boolean().optional()), declaration("b", z.string().optional())],
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("silently dropped");
    expect(message).toContain("advertising a fiction");
  });

  it.each([
    { name: "both plain strings", a: z.string(), b: z.string() },
    { name: "both optional", a: z.string().optional(), b: z.string().optional() },
    { name: "optional either side of a describe", a: z.string().optional().describe("x"), b: z.string().optional() },
  ])("accepts $name, which agree on what they take", ({ a, b }) => {
    expect(() =>
      resolveField({ name: "id", declarations: [declaration("one", a), declaration("two", b)] })
    ).not.toThrow();
  });
});
