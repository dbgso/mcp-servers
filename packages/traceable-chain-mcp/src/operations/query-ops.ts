import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Operation, OperationContext } from "./types.js";
import { getErrorMessage } from "mcp-shared";

const readArgsSchema = z.object({
  id: z.string().describe("Document ID (ULID)"),
});
type ReadArgs = z.infer<typeof readArgsSchema>;

export class ReadOp implements Operation<ReadArgs> {
  readonly id = "read";
  readonly summary = "Read a document by ID";
  readonly detail = `Read a document's content and metadata by its ID.

Examples:
  operation: "read"
  params: { id: "01HQXK3V7M..." }`;
  readonly argsSchema = readArgsSchema;
  async execute(args: ReadArgs, ctx: OperationContext): Promise<CallToolResult> {
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
  }
}

export const readOp = new ReadOp();

const listArgsSchema = z.object({
  type: z.string().optional().describe("Filter by document type"),
});
type ListArgs = z.infer<typeof listArgsSchema>;

export class ListOp implements Operation<ListArgs> {
  readonly id = "list";
  readonly summary = "List documents";
  readonly detail = `List all documents, optionally filtered by type.

Examples:
  operation: "list"
  params: {}
  params: { type: "spec" }`;
  readonly argsSchema = listArgsSchema;
  async execute(args: ListArgs, ctx: OperationContext): Promise<CallToolResult> {
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
        content: [{ type: "text", text: getErrorMessage(error) }],
        isError: true,
      };
    }
  }
}

export const listOp = new ListOp();

const traceArgsSchema = z.object({
  id: z.string().describe("Document ID to trace from"),
  direction: z.enum(["up", "down"]).optional()
    .describe("Trace direction: 'up' to ancestors, 'down' to descendants (default: down)"),
});
type TraceArgs = z.infer<typeof traceArgsSchema>;

export class TraceOp implements Operation<TraceArgs> {
  readonly id = "trace";
  readonly summary = "Trace document dependencies";
  readonly detail = `Trace the dependency tree from a document.
Direction "up" traces to ancestors, "down" traces to descendants.

Examples:
  operation: "trace"
  params: { id: "01HQXK3V7M..." }
  params: { id: "01HQXK3V7M...", direction: "up" }`;
  readonly argsSchema = traceArgsSchema;
  async execute(args: TraceArgs, ctx: OperationContext): Promise<CallToolResult> {
    const tree = await ctx.manager.trace({ id: args.id, direction: args.direction ?? "down" });
    if (!tree) {
      return {
        content: [{ type: "text", text: `Document "${args.id}" not found` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(tree, null, 2) }],
    };
  }
}

export const traceOp = new TraceOp();

const validateArgsSchema = z.object({});
type ValidateArgs = z.infer<typeof validateArgsSchema>;

export class ValidateOp implements Operation<ValidateArgs> {
  readonly id = "validate";
  readonly summary = "Validate all documents";
  readonly detail = `Check all documents for consistency and valid dependencies.

Examples:
  operation: "validate"
  params: {}`;
  readonly argsSchema = validateArgsSchema;
  async execute(_args: ValidateArgs, ctx: OperationContext): Promise<CallToolResult> {
    const result = await ctx.manager.validate();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
}

export const validateOp = new ValidateOp();

export const queryOperations = [readOp, listOp, traceOp, validateOp];
