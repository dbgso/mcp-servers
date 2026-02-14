import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Operation } from "./types.js";

const readArgsSchema = z.object({
  id: z.string().describe("Document ID (ULID)"),
});
type ReadArgs = z.infer<typeof readArgsSchema>;

export const readOp: Operation<ReadArgs> = {
  id: "read",
  summary: "Read a document by ID",
  detail: `Read a document's content and metadata by its ID.

Examples:
  operation: "read"
  params: { id: "01HQXK3V7M..." }`,
  argsSchema: readArgsSchema,
  execute: async (args, ctx): Promise<CallToolResult> => {
    const doc = await ctx.manager.read(args.id);
    if (!doc) {
      return {
        content: [{ type: "text", text: `Document "${args.id}" not found` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
    };
  },
};

const listArgsSchema = z.object({
  type: z.string().optional().describe("Filter by document type"),
});
type ListArgs = z.infer<typeof listArgsSchema>;

export const listOp: Operation<ListArgs> = {
  id: "list",
  summary: "List documents",
  detail: `List all documents, optionally filtered by type.

Examples:
  operation: "list"
  params: {}
  params: { type: "spec" }`,
  argsSchema: listArgsSchema,
  execute: async (args, ctx): Promise<CallToolResult> => {
    try {
      const docs = await ctx.manager.list(args.type);
      const summary = docs.map(d => ({
        id: d.id,
        type: d.type,
        title: d.title,
        requires: d.requires,
        created: d.created,
        updated: d.updated,
      }));
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total: docs.length,
            documents: summary,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  },
};

const traceArgsSchema = z.object({
  id: z.string().describe("Document ID to trace from"),
  direction: z.enum(["up", "down"]).optional()
    .describe("Trace direction: 'up' to ancestors, 'down' to descendants (default: down)"),
});
type TraceArgs = z.infer<typeof traceArgsSchema>;

export const traceOp: Operation<TraceArgs> = {
  id: "trace",
  summary: "Trace document dependencies",
  detail: `Trace the dependency tree from a document.
Direction "up" traces to ancestors, "down" traces to descendants.

Examples:
  operation: "trace"
  params: { id: "01HQXK3V7M..." }
  params: { id: "01HQXK3V7M...", direction: "up" }`,
  argsSchema: traceArgsSchema,
  execute: async (args, ctx): Promise<CallToolResult> => {
    const tree = await ctx.manager.trace(args.id, args.direction ?? "down");
    if (!tree) {
      return {
        content: [{ type: "text", text: `Document "${args.id}" not found` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(tree, null, 2) }],
    };
  },
};

const validateArgsSchema = z.object({});
type ValidateArgs = z.infer<typeof validateArgsSchema>;

export const validateOp: Operation<ValidateArgs> = {
  id: "validate",
  summary: "Validate all documents",
  detail: `Check all documents for consistency and valid dependencies.

Examples:
  operation: "validate"
  params: {}`,
  argsSchema: validateArgsSchema,
  execute: async (_args, ctx): Promise<CallToolResult> => {
    const result = await ctx.manager.validate();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  },
};

export const queryOperations = [readOp, listOp, traceOp, validateOp];
