/**
 * The describe/execute pair's remaining branches.
 *
 * What was uncovered is what varies between one server's operations and
 * another's: an optional preamble, an operation with no category, whether it
 * mutates, params omitted entirely, and an approval-gated operation that
 * forgot its preview. The last one is the interesting case -- a gate that
 * cannot compute what it is gating must refuse, not run.
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createDescribeExecuteHandlers,
  createOperationRegistry,
  type Operation,
} from "../tools/index.js";
import { jsonResponse } from "../utils/mcp-response.js";
import type { ApprovalStrategy } from "../utils/approval/strategy.js";

interface Ctx {
  prefix: string;
}

const text = (r: { content: { text?: string }[] }) => r.content[0].text ?? "";

const noParams: Operation<Record<string, never>, Ctx> = {
  id: "ping",
  summary: "Ping",
  detail: "Takes nothing.",
  argsSchema: z.object({}),
  execute: async () => jsonResponse({ pong: true }),
};

const mutating: Operation<{ id: string }, Ctx> = {
  id: "remove",
  summary: "Remove a thing",
  detail: "Deletes it.",
  category: "Writing",
  mutates: true,
  argsSchema: z.object({ id: z.string() }),
  execute: async ({ args }) => jsonResponse({ removed: args.id }),
};

function handlers(params: {
  ops: Operation<unknown, Ctx>[];
  preamble?: string;
  buildContext?: () => Ctx | Promise<Ctx>;
}) {
  return createDescribeExecuteHandlers({
    prefix: "test",
    registry: createOperationRegistry<Ctx>(params.ops),
    buildContext: params.buildContext ?? (() => ({ prefix: "[" })),
    ...(params.preamble === undefined ? {} : { preamble: params.preamble }),
  });
}

describe("describe", () => {
  it("puts the preamble above the list when there is one", async () => {
    const [describeTool] = handlers({
      ops: [noParams as Operation<unknown, Ctx>],
      preamble: "Read this first.",
    });

    const listing = text(await describeTool.execute({}));

    expect(listing.indexOf("Read this first.")).toBeLessThan(listing.indexOf("# Test Operations"));
  });

  it("files an operation with no category under Other", async () => {
    const [describeTool] = handlers({ ops: [noParams as Operation<unknown, Ctx>] });

    expect(text(await describeTool.execute({}))).toContain("## Other");
    expect(text(await describeTool.execute({ operation: "ping" }))).toContain(
      "**Category:** Other"
    );
  });

  it("says whether an operation mutates", async () => {
    // A caller deciding whether to gate something needs this in the
    // description, not in the source.
    const [describeTool] = handlers({ ops: [mutating as Operation<unknown, Ctx>] });

    expect(text(await describeTool.execute({ operation: "remove" }))).toContain(
      "**Mutates:** yes"
    );
    expect(text(await describeTool.execute({ operation: "ping" }))).not.toContain(
      "**Mutates:** yes"
    );
  });
});

describe("execute", () => {
  it("runs an operation that takes no params at all", async () => {
    // `params` omitted is not the same as `params: {}` to a caller writing
    // JSON by hand, and both have to work.
    const [, executeTool] = handlers({ ops: [noParams as Operation<unknown, Ctx>] });

    expect(text(await executeTool.execute({ operation: "ping" }))).toContain("pong");
  });

  it("lists what is available when the operation is unknown", async () => {
    const [, executeTool] = handlers({
      ops: [noParams as Operation<unknown, Ctx>, mutating as Operation<unknown, Ctx>],
    });

    const result = await executeTool.execute({ operation: "absent" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("ping, remove");
  });

  it("names the offending field and points at describe when params are wrong", async () => {
    const [, executeTool] = handlers({ ops: [mutating as Operation<unknown, Ctx>] });

    const result = await executeTool.execute({ operation: "remove", params: { id: 1 } });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("id:");
    expect(text(result)).toContain('test_describe({ operation: "remove" })');
  });

  it("builds the context from the params it was given", async () => {
    const buildContext = vi.fn(() => ({ prefix: "ctx" }));
    const [, executeTool] = handlers({ ops: [mutating as Operation<unknown, Ctx>], buildContext });

    await executeTool.execute({ operation: "remove", params: { id: "x" } });

    expect(buildContext).toHaveBeenCalledWith({ id: "x" });
  });

  it("passes an empty object when there are no params to build from", async () => {
    const buildContext = vi.fn(() => ({ prefix: "ctx" }));
    const [, executeTool] = handlers({ ops: [noParams as Operation<unknown, Ctx>], buildContext });

    await executeTool.execute({ operation: "ping" });

    expect(buildContext).toHaveBeenCalledWith({});
  });
});

describe("an approval-gated operation", () => {
  // Only a token approves. A stub that says `valid` unconditionally passes the
  // gate on the first call, which is a test that proves nothing.
  const strategy: ApprovalStrategy = {
    kind: "test",
    present: async (request) => ({ requestId: request.id, message: "approve please" }),
    validate: ({ providedToken }) =>
      providedToken === "1234" ? { valid: true } : { valid: false, reason: "not_found" },
  };

  it("refuses to run when it defines no preview", async () => {
    // The gate approves an exact, tool-computed change. Without a preview
    // there is nothing to compute, and running anyway would be an ungated
    // write under a gated operation's name.
    const gated: Operation<{ id: string }, Ctx> = {
      id: "gated",
      summary: "Gated",
      detail: "Needs approval.",
      mutates: true,
      approval: strategy,
      argsSchema: z.object({ id: z.string() }),
      execute: async () => jsonResponse({ ran: true }),
    };
    const [, executeTool] = handlers({ ops: [gated as Operation<unknown, Ctx>] });

    const result = await executeTool.execute({ operation: "gated", params: { id: "x" } });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("defines no preview()");
  });

  it("presents the change first, then runs it once approved", async () => {
    const gated: Operation<{ id: string }, Ctx> = {
      id: "gated",
      summary: "Gated",
      detail: "Needs approval.",
      mutates: true,
      approval: strategy,
      preview: async ({ args }) => `would remove ${args.id}`,
      argsSchema: z.object({ id: z.string() }),
      execute: async () => jsonResponse({ ran: true }),
    };
    const [, executeTool] = handlers({ ops: [gated as Operation<unknown, Ctx>] });

    const first = await executeTool.execute({ operation: "gated", params: { id: "x" } });
    expect(text(first)).toContain("approve please");

    const second = await executeTool.execute({
      operation: "gated",
      params: { id: "x" },
      approvalToken: "1234",
    });
    expect(text(second)).toContain("ran");
  });
});
