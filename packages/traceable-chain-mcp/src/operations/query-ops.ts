import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Operation } from "./types.js";

export const readOp: Operation = {
  id: "read",
  summary: "Read a document by ID",
  detail: `Read a document's content and metadata by its ID.

Examples:
  operation: "read"
  params: { id: "01HQXK3V7M..." }`,
  argsSchema: z.object({
    id: z.string().describe("Document ID (ULID)"),
  }),
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

export const listOp: Operation = {
  id: "list",
  summary: "List documents",
  detail: `List all documents, optionally filtered by type.

Examples:
  operation: "list"
  params: {}
  params: { type: "spec" }`,
  argsSchema: z.object({
    type: z.string().optional().describe("Filter by document type"),
  }),
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

export const traceOp: Operation = {
  id: "trace",
  summary: "Trace document dependencies",
  detail: `Trace the dependency tree from a document.
Direction "up" traces to ancestors, "down" traces to descendants.

Examples:
  operation: "trace"
  params: { id: "01HQXK3V7M..." }
  params: { id: "01HQXK3V7M...", direction: "up" }`,
  argsSchema: z.object({
    id: z.string().describe("Document ID to trace from"),
    direction: z.enum(["up", "down"]).optional().default("down")
      .describe("Trace direction: 'up' to ancestors, 'down' to descendants"),
  }),
  execute: async (args, ctx): Promise<CallToolResult> => {
    const tree = await ctx.manager.trace(args.id, args.direction);
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

export const validateOp: Operation = {
  id: "validate",
  summary: "Validate all documents",
  detail: `Check all documents for consistency and valid dependencies.

Examples:
  operation: "validate"
  params: {}`,
  argsSchema: z.object({}),
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

export const queryOperations: Operation[] = [readOp, listOp, traceOp, validateOp];
