import { z } from "zod";
import { jsonResponse, type Operation } from "mcp-shared";
import { formatJoinResult, formatWatch } from "./format.js";
import { guarded, type WaitContext } from "./types.js";

const watchSpecShape = {
  source: z.string().describe('Source id, e.g. "github_checks" (see operation "sources")'),
  config: z.record(z.unknown()).describe("Source-specific config"),
  interval_ms: z.number().int().positive().optional().describe("Polling interval (clamped to the source minimum)"),
  timeout_ms: z.number().int().positive().optional().describe("Deadline for the whole watch (default: 1800000)"),
  label: z.string().optional().describe("Name shown in listings"),
};

const untilArgsSchema = z.object({
  ...watchSpecShape,
  max_block_ms: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("How long this single call may block (default: 240000)"),
});
type UntilArgs = z.infer<typeof untilArgsSchema>;

const watchArgsSchema = z.object(watchSpecShape);
type WatchArgs = z.infer<typeof watchArgsSchema>;

const joinArgsSchema = z.object({
  ids: z.array(z.string()).min(1).describe("Watch ids to block on"),
  mode: z.enum(["any", "all"]).optional().describe('"all" (default) or "any"'),
  max_block_ms: z.number().int().positive().optional().describe("How long this single call may block"),
});
type JoinArgs = z.infer<typeof joinArgsSchema>;

const checkArgsSchema = z.object({
  source: z.string().describe("Source id"),
  config: z.record(z.unknown()).describe("Source-specific config"),
});
type CheckArgs = z.infer<typeof checkArgsSchema>;

export const untilOp: Operation<UntilArgs, WaitContext> = {
  id: "until",
  summary: "Create a watch and block until it settles (the normal way to wait)",
  detail: `Starts server-side polling and blocks this tool call until the watch reaches a terminal state.
Waiting costs no context: the whole wait is a single request and a single response.

If the call reaches \`max_block_ms\` first, it returns \`status: "waiting"\` while the watch keeps
polling in the background; resume with the \`join\` call shown in \`next\`.

Examples:
  params: { source: "github_checks", config: { pr: 42, require: "success" } }
  params: { source: "slack", config: { channel: "C0123", thread_ts: "1712345678.000100" }, timeout_ms: 3600000 }`,
  category: "Wait",
  argsSchema: untilArgsSchema,
  execute: ({ args, ctx }) =>
    guarded(async () => {
      const result = await ctx.manager.until({
        spec: {
          source: args.source,
          config: args.config,
          intervalMs: args.interval_ms,
          timeoutMs: args.timeout_ms,
          label: args.label,
        },
        maxBlockMs: args.max_block_ms,
      });
      return jsonResponse(formatJoinResult({ result, now: ctx.manager.now() }));
    }),
};

export const watchOp: Operation<WatchArgs, WaitContext> = {
  id: "watch",
  summary: "Create a watch and return its id immediately (does not block)",
  detail: `Starts polling in the background and returns right away. Use this to run several waits in
parallel, then block on them together with \`join\`.

Examples:
  params: { source: "github_checks", config: { pr: 42 }, label: "ci" }
  params: { source: "github_issue", config: { number: 34, until: "new_comment" }, label: "review" }`,
  category: "Wait",
  argsSchema: watchArgsSchema,
  execute: ({ args, ctx }) =>
    guarded(async () => {
      const watch = ctx.manager.create({
        source: args.source,
        config: args.config,
        intervalMs: args.interval_ms,
        timeoutMs: args.timeout_ms,
        label: args.label,
      });
      return jsonResponse(formatWatch({ watch, now: ctx.manager.now() }));
    }),
};

export const joinOp: Operation<JoinArgs, WaitContext> = {
  id: "join",
  summary: "Block until existing watches settle",
  detail: `Blocks on watches created earlier by \`watch\` or left running by a \`until\` call that hit its
block limit. \`mode: "any"\` returns as soon as the first of them settles.

Examples:
  params: { ids: ["w_1"] }
  params: { ids: ["w_1", "w_2"], mode: "any" }`,
  category: "Wait",
  argsSchema: joinArgsSchema,
  execute: ({ args, ctx }) =>
    guarded(async () => {
      const result = await ctx.manager.join({
        ids: args.ids,
        mode: args.mode,
        maxBlockMs: args.max_block_ms,
      });
      return jsonResponse(formatJoinResult({ result, now: ctx.manager.now() }));
    }),
};

export const checkOp: Operation<CheckArgs, WaitContext> = {
  id: "check",
  summary: "Evaluate a condition once, without creating a watch",
  detail: `Runs a single poll and returns the result. Use it to validate a config or to see whether
waiting is worth it at all.

Conditions that are defined relative to the start of a watch (new_comment, state_change, slack,
file changed) report the state they would use as the baseline instead of firing.

Examples:
  params: { source: "github_checks", config: { ref: "main" } }
  params: { source: "http", config: { url: "https://example.com/healthz", expect: { status: 200 } } }`,
  category: "Wait",
  argsSchema: checkArgsSchema,
  execute: ({ args, ctx }) =>
    guarded(async () => {
      const outcome = await ctx.manager.checkOnce({ source: args.source, config: args.config });
      return jsonResponse({
        source: args.source,
        satisfied: outcome.satisfied,
        summary: outcome.summary,
        details: outcome.details,
      });
    }),
};

export const waitOperations = [untilOp, watchOp, joinOp, checkOp] as Operation<unknown, WaitContext>[];
