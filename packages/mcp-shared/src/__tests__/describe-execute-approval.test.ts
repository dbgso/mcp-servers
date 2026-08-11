import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  createOperationRegistry,
  createDescribeExecuteHandlers,
  type Operation,
} from "../tools/index.js";
import { jsonResponse } from "../utils/mcp-response.js";
import { TokenApprovalStrategy } from "../utils/approval/token.js";
import { requestApproval, contentHash } from "../utils/approval/core.js";

interface Ctx {
  runs: string[];
}

let runs: string[];

const writeOp: Operation<{ path: string; content: string }, Ctx> = {
  id: "write",
  summary: "Write a file",
  detail: "Writes content to a path.",
  mutates: true,
  approval: new TokenApprovalStrategy(),
  argsSchema: z.object({ path: z.string(), content: z.string() }),
  preview: ({ args }) => `--- ${args.path}\n+++ ${args.path}\n+${args.content}`,
  execute: async ({ args, ctx }) => {
    ctx.runs.push(args.path);
    return jsonResponse({ written: args.path });
  },
};

const readOp: Operation<{ path: string }, Ctx> = {
  id: "read",
  summary: "Read a file",
  detail: "Reads a path.",
  argsSchema: z.object({ path: z.string() }),
  execute: async ({ args }) => jsonResponse({ read: args.path }),
};

// Gated op that forgot to define preview() — a misconfiguration.
const badOp: Operation<Record<string, never>, Ctx> = {
  id: "bad",
  summary: "Gated without preview",
  detail: "",
  approval: new TokenApprovalStrategy(),
  argsSchema: z.object({}),
  execute: async () => jsonResponse({ ok: true }),
};

function build() {
  runs = [];
  const registry = createOperationRegistry<Ctx>([
    writeOp as Operation<unknown, Ctx>,
    readOp as Operation<unknown, Ctx>,
    badOp as Operation<unknown, Ctx>,
  ]);
  return createDescribeExecuteHandlers({
    prefix: "test",
    registry,
    buildContext: () => ({ runs }),
  });
}

const text = (r: { content: { type: string }[] }) =>
  (r.content[0] as unknown as { text: string }).text;

// Reconstruct the requestId the gate derives, then plant an approval token.
async function approve(params: { path: string; content: string }): Promise<string> {
  const what = `--- ${params.path}\n+++ ${params.path}\n+${params.content}`;
  const id = `test_execute:write:${contentHash(what)}`;
  const { token } = await requestApproval({
    request: { id, operation: "test_execute write", description: "Write a file", what },
  });
  return token;
}

describe("execute approval gate", () => {
  beforeEach(() => build());

  it("read (ungated) op runs without approval", async () => {
    const [, execute] = build();
    const res = await execute.execute({ operation: "read", params: { path: "a" } });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(text(res)).read).toBe("a");
  });

  it("gated op returns an approval prompt and does not execute on the first call", async () => {
    const [, execute] = build();
    const res = await execute.execute({
      operation: "write",
      params: { path: "f.txt", content: "hi" },
    });
    expect(text(res)).toContain("Approval required");
    expect(runs).toEqual([]); // op body never ran
  });

  it("gated op executes once the content-bound token is supplied", async () => {
    const [, execute] = build();
    const token = await approve({ path: "f.txt", content: "hi" });
    const res = await execute.execute({
      operation: "write",
      params: { path: "f.txt", content: "hi" },
      approvalToken: token,
    });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(text(res)).written).toBe("f.txt");
    expect(runs).toEqual(["f.txt"]);
  });

  it("an approval does not carry over to different params (content binding)", async () => {
    const [, execute] = build();
    const token = await approve({ path: "f.txt", content: "hi" });
    // Same token, but a different change than what was approved.
    const res = await execute.execute({
      operation: "write",
      params: { path: "f.txt", content: "TAMPERED" },
      approvalToken: token,
    });
    expect(text(res)).toContain("Approval required");
    expect(runs).toEqual([]);
  });

  it("a gated op without preview() is a clear error, not a silent bypass", async () => {
    const [, execute] = build();
    const res = await execute.execute({ operation: "bad", params: {} });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("no preview");
    expect(runs).toEqual([]);
  });
});
