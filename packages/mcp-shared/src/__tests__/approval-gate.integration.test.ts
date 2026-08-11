import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import {
  createOperationRegistry,
  createDescribeExecuteHandlers,
  type Operation,
} from "../tools/index.js";
import { jsonResponse } from "../utils/mcp-response.js";
import { TokenApprovalStrategy } from "../utils/approval/token.js";
import { HtmlApprovalStrategy } from "../utils/approval/html.js";
import * as approvalMod from "../utils/approval/core.js";
// stopHtmlServer only; the registration comes from ../approval.js above.
import { stopHtmlServer } from "../utils/approval/html.js";

/**
 * Integration coverage for the approval gate.
 *
 * Philosophy: drive every path through the *real* HTTP server and the real
 * execute handler, mocking only the OS notification boundary (node-notifier is
 * already skipped in test env) and capturing the token by spying on
 * requestApproval — the same value a human would read from the notification.
 * No live desktop / no manual step required.
 *
 * Several tests here assert SECURITY properties the current implementation does
 * not yet satisfy — they are expected to be RED until the review findings are
 * fixed, and they pin the target behaviour.
 */

interface Ctx {
  runs: string[];
}
let runs: string[];

const htmlOp: Operation<{ path: string; content: string }, Ctx> = {
  id: "write",
  summary: "Write a file",
  detail: "",
  mutates: true,
  approval: new HtmlApprovalStrategy(),
  argsSchema: z.object({ path: z.string(), content: z.string() }),
  preview: ({ args }) => `@@ hunk1 @@\n+${args.content}\n@@ hunk2 @@\n+${args.path}`,
  execute: async ({ args, ctx }) => {
    ctx.runs.push(args.path);
    return jsonResponse({ written: args.path });
  },
};

const tokenOp: Operation<{ x: number }, Ctx> = {
  id: "bump",
  summary: "Bump a value",
  detail: "",
  mutates: true,
  approval: new TokenApprovalStrategy(),
  argsSchema: z.object({ x: z.number() }),
  preview: ({ args }) => `set x=${args.x}`,
  execute: async ({ args, ctx }) => {
    ctx.runs.push(`bump:${args.x}`);
    return jsonResponse({ x: args.x });
  },
};

function build() {
  runs = [];
  const registry = createOperationRegistry<Ctx>([
    htmlOp as Operation<unknown, Ctx>,
    tokenOp as Operation<unknown, Ctx>,
  ]);
  return createDescribeExecuteHandlers({ prefix: "test", registry, buildContext: () => ({ runs }) });
}

const text = (r: { content: { type: string }[] }) =>
  (r.content[0] as unknown as { text: string }).text;

let tokenSpy: ReturnType<typeof vi.spyOn>;

// The token a human would read from the notification: captured from the most
// recent requestApproval() return value (spyOn calls through by default).
async function latestToken(): Promise<string> {
  const result = tokenSpy.mock.results.at(-1)!.value as Promise<{ token: string }>;
  return (await result).token;
}

function extractUrl(message: string): string {
  const m = message.match(/http:\/\/127\.0\.0\.1:\d+\/approve\/[^\s]+/);
  if (!m) throw new Error(`no review URL in message:\n${message}`);
  return m[0];
}

async function post(url: string, token: string, acks: number[]): Promise<Response> {
  const body = new URLSearchParams();
  body.set("token", token);
  for (const a of acks) body.append("ack", String(a));
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

beforeEach(() => {
  runs = [];
  tokenSpy = vi.spyOn(approvalMod, "requestApproval");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await stopHtmlServer();
});

describe("approval gate — full HTTP round-trip (baseline, should pass)", () => {
  it("HTML: GET the page, POST token+all acks, then the op executes", async () => {
    const [, execute] = build();

    const r1 = await execute.execute({ operation: "write", params: { path: "a.txt", content: "hi" } });
    expect(text(r1)).toContain("Approval required");
    expect(runs).toEqual([]);

    const url = extractUrl(text(r1));
    const token = await latestToken();

    const page = await (await fetch(url)).text();
    expect(page).toContain('name="token"');

    const approved = await post(url, token, [0, 1]);
    expect(approved.status).toBe(200);

    const r2 = await execute.execute({ operation: "write", params: { path: "a.txt", content: "hi" } });
    expect(runs).toEqual(["a.txt"]);
    expect(JSON.parse(text(r2)).written).toBe("a.txt");
  });
});

describe("approval gate — poll must not destroy an in-progress approval (#2)", () => {
  it("token: a poll/retry does not rotate the already-notified token", async () => {
    const [, execute] = build();

    // First call: approval requested, token A notified to the human.
    await execute.execute({ operation: "bump", params: { x: 1 } });
    const tokenA = await latestToken();

    // The agent polls again before the human has responded.
    await execute.execute({ operation: "bump", params: { x: 1 } });

    // The human enters token A (from the first notification). It must still work.
    await execute.execute({ operation: "bump", params: { x: 1 }, approvalToken: tokenA });
    expect(runs).toEqual(["bump:1"]);
  });

  it("html: a poll before approval does not reset the session or rotate the token", async () => {
    const [, execute] = build();

    const r1 = await execute.execute({ operation: "write", params: { path: "a.txt", content: "hi" } });
    const url = extractUrl(text(r1));
    const token = await latestToken();

    // Agent polls again before the human has approved.
    await execute.execute({ operation: "write", params: { path: "a.txt", content: "hi" } });

    // The human approves with the token from the FIRST notification + all acks.
    const approved = await post(url, token, [0, 1]);
    expect(approved.status).toBe(200);

    const r3 = await execute.execute({ operation: "write", params: { path: "a.txt", content: "hi" } });
    expect(runs).toEqual(["a.txt"]);
    expect(JSON.parse(text(r3)).written).toBe("a.txt");
  });
});
