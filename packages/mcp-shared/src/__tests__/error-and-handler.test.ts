/**
 * Error-message extraction, the tool-handler base class, and operation
 * grouping.
 *
 * `getErrorMessage` is on every catch path in every server in this
 * repository, and it was at 57% -- the cases it exists for (a thrown string, a
 * thrown null, an object that happens to carry a message) were the untested
 * ones.
 */

import { describe, expect, it } from "vitest";

import { BaseToolHandler } from "../tools/base-handler.js";
import { OperationRegistry } from "../tools/operation.js";
import { getErrorMessage, wrapError } from "../utils/error.js";
import type { ToolResponse, ZodLikeSchema } from "../tools/types.js";

describe("getErrorMessage", () => {
  it.each([
    ["an Error", new Error("it broke"), "it broke"],
    ["a subclass", new TypeError("wrong type"), "wrong type"],
    ["null", null, "Unknown error"],
    ["undefined", undefined, "Unknown error"],
    ["a string", "just a string", "just a string"],
    ["a number", 42, "42"],
    ["a plain object with a message", { message: "duck typed" }, "duck typed"],
  ])("reads %s", (_name, input, expected) => {
    expect(getErrorMessage(input)).toBe(expected);
  });

  it("falls back to String() when message is not a string", () => {
    // A rejection carrying `{ message: 500 }` is not an Error, and reading
    // `.message` blindly would put "500" where a sentence belongs -- or worse,
    // an object, which stringifies to nothing useful.
    expect(getErrorMessage({ message: 500 })).toBe("[object Object]");
  });

  it("reads a message from a class that is not an Error", () => {
    class Failure {
      readonly message = "not an Error, still has a message";
    }

    expect(getErrorMessage(new Failure())).toBe("not an Error, still has a message");
  });

  it("does not mistake an empty object for a message", () => {
    expect(getErrorMessage({})).toBe("[object Object]");
  });
});

describe("wrapError", () => {
  it("puts the context in front of the message", () => {
    expect(wrapError({ context: "Failed to read file", error: new Error("ENOENT") })).toBe(
      "Failed to read file: ENOENT"
    );
  });

  it("still reads as a sentence when there is no message to find", () => {
    expect(wrapError({ context: "Failed to read file", error: null })).toBe(
      "Failed to read file: Unknown error"
    );
  });
});

describe("BaseToolHandler", () => {
  const schema = {
    safeParse: (input: unknown) => {
      const value = input as { path?: unknown };
      return typeof value?.path === "string"
        ? { success: true as const, data: { path: value.path } }
        : { success: false as const, error: { message: "path must be a string" } };
    },
  } as unknown as ZodLikeSchema<{ path: string }>;

  class Handler extends BaseToolHandler<{ path: string }> {
    readonly name = "read_file";
    readonly description = "Read a file";
    readonly schema = schema;
    readonly inputSchema = { type: "object" };

    constructor(private readonly behaviour?: () => Promise<ToolResponse>) {
      super();
    }

    protected async doExecute(args: { path: string }): Promise<ToolResponse> {
      if (this.behaviour) return this.behaviour();
      return { content: [{ type: "text" as const, text: `read ${args.path}` }] };
    }
  }

  it("parses, then delegates", async () => {
    const result = await new Handler().execute({ path: "a.ts" });

    expect(result.content[0].text).toBe("read a.ts");
  });

  it("reports an invalid argument instead of running", async () => {
    const result = await new Handler().execute({ path: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Invalid arguments: path must be a string");
  });

  it("turns a throw into a response naming the tool", async () => {
    const handler = new Handler(async () => {
      throw new Error("the disk is full");
    });

    const result = await handler.execute({ path: "a.ts" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Failed to execute read_file: the disk is full");
  });

  it("reports a thrown non-Error too", async () => {
    const handler = new Handler(async () => {
      throw "just a string";
    });

    expect((await handler.execute({ path: "a.ts" })).content[0].text).toContain("just a string");
  });
});

describe("OperationRegistry.byCategory", () => {
  const op = (id: string, category?: string) =>
    ({ id, category, description: id, schema: { safeParse: () => ({ success: true, data: {} }) }, execute: async () => ({ content: [] }) }) as never;

  it("groups by the declared category", () => {
    // `registerAll` returns void here, while `ToolRegistry` and
    // `ActionRegistry` both return `this` and chain. Not worth changing for
    // its own sake, but worth a test that reads the way the API actually is.
    const registry = new OperationRegistry();
    registry.registerAll([op("read", "Reading"), op("list", "Reading"), op("write", "Writing")]);

    const grouped = registry.byCategory();

    expect(Object.keys(grouped)).toEqual(["Reading", "Writing"]);
    expect(grouped.Reading.map((o) => o.id)).toEqual(["read", "list"]);
  });

  it("puts an operation with no category under Other", () => {
    // Otherwise it would land under `undefined`, which is what a reader of the
    // describe output would see as a heading.
    const registry = new OperationRegistry();
    registry.registerAll([op("stray"), op("read", "Reading")]);

    expect(registry.byCategory().Other.map((o) => o.id)).toEqual(["stray"]);
  });

  it("has no groups when nothing is registered", () => {
    expect(new OperationRegistry().byCategory()).toEqual({});
    expect(new OperationRegistry().all()).toEqual([]);
  });
});
