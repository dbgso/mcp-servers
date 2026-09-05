import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { errorResponse, jsonResponse, type Operation } from "mcp-shared";
import { allSources, getSource, getSourcesByCategory } from "../sources/registry.js";
import { formatWatch } from "./format.js";
import { guarded, type WaitContext } from "./types.js";

const statusArgsSchema = z.object({
  id: z.string().optional().describe("Watch id; omit for the full list"),
  include_finished: z.boolean().optional().describe("Include settled watches (default: true)"),
});
type StatusArgs = z.infer<typeof statusArgsSchema>;

const cancelArgsSchema = z.object({
  id: z.string().optional().describe("Watch id to cancel"),
  all: z.boolean().optional().describe("Cancel every waiting watch"),
});
type CancelArgs = z.infer<typeof cancelArgsSchema>;

const sourcesArgsSchema = z.object({
  source: z.string().optional().describe("Source id; omit for the full list"),
});
type SourcesArgs = z.infer<typeof sourcesArgsSchema>;

export const statusOp: Operation<StatusArgs, WaitContext> = {
  id: "status",
  summary: "List watches, or inspect one with its recent events",
  detail: `Without \`id\`, returns a one-line summary of every watch known to this server process.
With \`id\`, returns that watch including its recent events and structured details.

Examples:
  params: {}
  params: { id: "w_1" }
  params: { include_finished: false }`,
  category: "Manage",
  argsSchema: statusArgsSchema,
  execute: ({ args, ctx }) =>
    guarded(async () => {
      const now = ctx.manager.now();

      if (args.id !== undefined) {
        const watch = ctx.manager.requireWatch(args.id);
        return jsonResponse(formatWatch({ watch, now, includeEvents: true, includeDetails: true }));
      }

      const includeFinished = args.include_finished ?? true;
      const watches = ctx.manager
        .list()
        .filter((watch) => includeFinished || watch.status === "waiting")
        .map((watch) => formatWatch({ watch, now }));

      return jsonResponse({ total: watches.length, watches });
    }),
};

export const cancelOp: Operation<CancelArgs, WaitContext> = {
  id: "cancel",
  summary: "Cancel a watch, or every waiting watch",
  detail: `Stops polling and settles the watch as \`cancelled\`. Any call blocked on it returns immediately.

Examples:
  params: { id: "w_1" }
  params: { all: true }`,
  category: "Manage",
  argsSchema: cancelArgsSchema,
  execute: ({ args, ctx }) =>
    guarded(async () => {
      const now = ctx.manager.now();

      // Exactly one of id / all selects what to cancel
      if (args.all === true && args.id !== undefined) {
        return errorResponse('Specify either "id" or "all", not both.');
      }

      if (args.all === true) {
        const cancelled = ctx.manager.cancelAll().map((watch) => formatWatch({ watch, now }));
        return jsonResponse({ cancelled: cancelled.length, watches: cancelled });
      }

      if (args.id === undefined) {
        return errorResponse('Specify "id" to cancel one watch, or "all": true to cancel every waiting watch.');
      }

      const watch = ctx.manager.cancel(args.id);
      return jsonResponse(formatWatch({ watch, now }));
    }),
};

export const sourcesOp: Operation<SourcesArgs, WaitContext> = {
  id: "sources",
  summary: "List watchable sources, or show one source's config schema",
  detail: `Every source is a read-only observer: it polls an external system but never changes it.

Examples:
  params: {}
  params: { source: "github_checks" }`,
  category: "Manage",
  argsSchema: sourcesArgsSchema,
  execute: ({ args }) =>
    guarded(async () => {
      if (args.source !== undefined) {
        const source = getSource(args.source);
        if (!source) {
          const available = allSources.map((entry) => entry.id).join(", ");
          return errorResponse(`Unknown source: "${args.source}". Available: ${available}`);
        }
        return jsonResponse({
          id: source.id,
          summary: source.summary,
          detail: source.detail,
          category: source.category,
          default_interval_ms: source.defaultIntervalMs,
          min_interval_ms: source.minIntervalMs,
          config_schema: zodToJsonSchema(source.configSchema, { target: "openApi3" }),
        });
      }

      const byCategory = getSourcesByCategory();
      const listing = Object.entries(byCategory).map(([category, sources]) => ({
        category,
        sources: sources.map((source) => ({
          id: source.id,
          summary: source.summary,
          default_interval_ms: source.defaultIntervalMs,
        })),
      }));

      return jsonResponse({ total: allSources.length, categories: listing });
    }),
};

export const manageOperations = [statusOp, cancelOp, sourcesOp] as Operation<unknown, WaitContext>[];
