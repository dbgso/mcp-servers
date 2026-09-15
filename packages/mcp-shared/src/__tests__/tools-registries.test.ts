/**
 * The two registries and the action-handler base class.
 *
 * All three were at 0% coverage: every server in this repository dispatches
 * through them, and nothing tested them directly. What that hid is in here --
 * `ToolRegistry.register` overwrites silently while `ActionRegistry.register`
 * throws, and only one of those is a deliberate difference.
 */

import { describe, expect, it, vi } from "vitest";

import { ActionRegistry } from "../tools/action-registry.js";
import { BaseActionHandler } from "../tools/base-action-handler.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ToolHandler, ToolResponse, ZodLikeSchema } from "../tools/types.js";

function toolHandler(params: { name: string; description?: string }): ToolHandler {
  const { name, description = `does ${name}` } = params;
  return {
    name,
    description,
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
    execute: async () => ({ content: [{ type: "text" as const, text: name }] }),
  } as unknown as ToolHandler;
}

function actionHandler(params: { action: string; help?: string }) {
  return { action: params.action, help: params.help ?? `help for ${params.action}` };
}

describe("ToolRegistry", () => {
  it("registers and looks up by name", () => {
    const registry = new ToolRegistry().register(toolHandler({ name: "plan" }));

    expect(registry.getHandler("plan")?.name).toBe("plan");
    expect(registry.hasHandler("plan")).toBe(true);
  });

  it("returns undefined for a name it does not have", () => {
    expect(new ToolRegistry().getHandler("absent")).toBeUndefined();
    expect(new ToolRegistry().hasHandler("absent")).toBe(false);
  });

  it("registers several at once, and chains", () => {
    const registry = new ToolRegistry().registerAll([
      toolHandler({ name: "a" }),
      toolHandler({ name: "b" }),
    ]);

    expect(registry.getToolNames()).toEqual(["a", "b"]);
  });

  it("keeps registration order in the tool list", () => {
    // The order the server advertises its tools in is the order they were
    // registered, which is what a client shows a user.
    const registry = new ToolRegistry().registerAll([
      toolHandler({ name: "second" }),
      toolHandler({ name: "first" }),
    ]);

    expect(registry.getAllTools().map((t) => t.name)).toEqual(["second", "first"]);
  });

  it("describes each tool for MCP listing", () => {
    const registry = new ToolRegistry().register(
      toolHandler({ name: "plan", description: "plan things" })
    );

    expect(registry.getAllTools()).toEqual([
      {
        name: "plan",
        description: "plan things",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
      },
    ]);
  });

  it("lets a later registration replace an earlier one of the same name", () => {
    // Unlike `ActionRegistry`, this one does not object. Pinned because the
    // difference is easy to read as an oversight in either direction: a server
    // that registers two tools under one name loses the first without a word.
    const registry = new ToolRegistry()
      .register(toolHandler({ name: "plan", description: "first" }))
      .register(toolHandler({ name: "plan", description: "second" }));

    expect(registry.getToolNames()).toEqual(["plan"]);
    expect(registry.getHandler("plan")?.description).toBe("second");
  });
});

describe("ActionRegistry", () => {
  it("registers and looks up by action", () => {
    const registry = new ActionRegistry().register(actionHandler({ action: "add" }));

    expect(registry.getHandler("add")?.action).toBe("add");
    expect(registry.hasHandler("add")).toBe(true);
    expect(registry.getActions()).toEqual(["add"]);
  });

  it("returns undefined for an action it does not have", () => {
    const registry = new ActionRegistry();

    expect(registry.getHandler("absent")).toBeUndefined();
    expect(registry.hasHandler("absent")).toBe(false);
    expect(registry.getHelp("absent")).toBeUndefined();
  });

  it("refuses a second handler for the same action", () => {
    // Two handlers for one action is a programming error, not a replacement:
    // which one answers would depend on import order.
    const registry = new ActionRegistry().register(actionHandler({ action: "add" }));

    expect(() => registry.register(actionHandler({ action: "add" }))).toThrow(
      'Handler for action "add" is already registered'
    );
  });

  it("stops the whole batch on a duplicate, leaving what came before", () => {
    const registry = new ActionRegistry().register(actionHandler({ action: "add" }));

    expect(() =>
      registry.registerAll([actionHandler({ action: "list" }), actionHandler({ action: "add" })])
    ).toThrow();
    // `list` was registered before the throw; nothing rolls it back.
    expect(registry.getActions()).toEqual(["add", "list"]);
  });

  it("gathers the help of every action, in registration order", () => {
    const registry = new ActionRegistry().registerAll([
      actionHandler({ action: "add", help: "Add a thing" }),
      actionHandler({ action: "list", help: "List things" }),
    ]);

    expect(registry.getAllHelp()).toBe("## add\n\nAdd a thing\n\n---\n\n## list\n\nList things");
    expect(registry.getHelp("list")).toBe("List things");
  });

  it("has no help to gather when nothing is registered", () => {
    expect(new ActionRegistry().getAllHelp()).toBe("");
  });
});

describe("BaseActionHandler", () => {
  const schema = {
    safeParse: (input: unknown) => {
      const value = input as { id?: unknown };
      return typeof value?.id === "string"
        ? { success: true as const, data: { id: value.id } }
        : { success: false as const, error: { message: "id must be a string" } };
    },
  } as unknown as ZodLikeSchema<{ id: string }>;

  class Handler extends BaseActionHandler<{ id: string }, { seen: string[] }> {
    readonly action = "add";
    readonly help = "Add a thing";
    readonly schema = schema;

    constructor(private readonly behaviour: (id: string) => Promise<ToolResponse> = async (id) => ({
      content: [{ type: "text" as const, text: `added ${id}` }],
    })) {
      super();
    }

    protected async doExecute(params: {
      args: { id: string };
      context: { seen: string[] };
    }): Promise<ToolResponse> {
      params.context.seen.push(params.args.id);
      return this.behaviour(params.args.id);
    }
  }

  it("parses, then delegates with the parsed arguments and the context", async () => {
    const context = { seen: [] as string[] };

    const result = await new Handler().execute({ rawParams: { id: "x" }, context });

    expect(result.content[0].text).toBe("added x");
    expect(context.seen).toEqual(["x"]);
  });

  it("returns the schema error with the action and its help, and does not run", async () => {
    // The help goes in because this response is the only thing the caller
    // sees: an argument error with no usage is a dead end.
    const context = { seen: [] as string[] };

    const result = await new Handler().execute({ rawParams: { id: 1 }, context });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("[add]");
    expect(result.content[0].text).toContain("id must be a string");
    expect(result.content[0].text).toContain("Add a thing");
    expect(context.seen).toEqual([]);
  });

  it("turns a thrown error into a response rather than letting it escape", async () => {
    // A handler that throws would otherwise take the whole tool call down,
    // and the caller would get a transport error instead of something to read.
    const handler = new Handler(async () => {
      throw new Error("the disk is full");
    });

    const result = await handler.execute({ rawParams: { id: "x" }, context: { seen: [] } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Failed to execute add: the disk is full");
  });

  it("reports a thrown non-Error too", async () => {
    const handler = new Handler(async () => {
      throw "just a string";
    });

    const result = await handler.execute({ rawParams: { id: "x" }, context: { seen: [] } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("just a string");
  });

  it("awaits the handler rather than returning its promise", async () => {
    const order: string[] = [];
    const handler = new Handler(async (id) => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(`done ${id}`);
      return { content: [{ type: "text" as const, text: "ok" }] };
    });

    await handler.execute({ rawParams: { id: "x" }, context: { seen: [] } });
    order.push("after");

    expect(order).toEqual(["done x", "after"]);
  });
});
