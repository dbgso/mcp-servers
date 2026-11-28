import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Operation, OperationContext } from "./types.js";
import { getErrorMessage } from "mcp-shared";

const createArgsSchema = z.object({
  type: z.string().describe("Document type"),
  requires: z.string().optional().describe("Parent document ID (required for non-root types)"),
  title: z.string().describe("Document title"),
  content: z.string().describe("Document content (markdown)"),
});
type CreateArgs = z.infer<typeof createArgsSchema>;

export class CreateOp implements Operation<CreateArgs> {
  readonly id = "create";
  readonly summary = "Create a new document";
  readonly detail = `Create a new document with enforced dependency.
The 'requires' field is mandatory for non-root types.

Examples:
  operation: "create"
  params: { type: "requirement", title: "User Auth", content: "..." }
  params: { type: "spec", requires: "01HQXK2A8N...", title: "Auth Spec", content: "..." }`;
  readonly argsSchema = createArgsSchema;
  async execute(args: CreateArgs, ctx: OperationContext): Promise<CallToolResult> {
    try {
      const doc = await ctx.manager.create({
        type: args.type,
        title: args.title,
        content: args.content,
        requires: args.requires,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: "Document created successfully",
            document: {
              id: doc.id,
              type: doc.type,
              title: doc.title,
              requires: doc.requires,
              filePath: doc.filePath,
            },
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

export const createOp = new CreateOp();

const updateArgsSchema = z.object({
  id: z.string().describe("Document ID to update"),
  title: z.string().optional().describe("New title"),
  content: z.string().optional().describe("New content"),
});
type UpdateArgs = z.infer<typeof updateArgsSchema>;

export class UpdateOp implements Operation<UpdateArgs> {
  readonly id = "update";
  readonly summary = "Update a document";
  readonly detail = `Update an existing document's title or content.
The document type and dependencies cannot be changed.

Examples:
  operation: "update"
  params: { id: "01HQXK3V7M...", title: "New Title" }
  params: { id: "01HQXK3V7M...", content: "Updated content..." }`;
  readonly argsSchema = updateArgsSchema;
  async execute(args: UpdateArgs, ctx: OperationContext): Promise<CallToolResult> {
    try {
      const doc = await ctx.manager.update({
        id: args.id,
        updates: {
          title: args.title,
          content: args.content,
        },
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: "Document updated successfully",
            document: {
              id: doc.id,
              type: doc.type,
              title: doc.title,
              updated: doc.updated,
            },
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

export const updateOp = new UpdateOp();

const deleteArgsSchema = z.object({
  id: z.string().describe("Document ID to delete"),
});
type DeleteArgs = z.infer<typeof deleteArgsSchema>;

export class DeleteOp implements Operation<DeleteArgs> {
  readonly id = "delete";
  readonly summary = "Delete a document";
  readonly detail = `Delete a document. Will fail if other documents depend on it.

Examples:
  operation: "delete"
  params: { id: "01HQXK3V7M..." }`;
  readonly argsSchema = deleteArgsSchema;
  async execute(args: DeleteArgs, ctx: OperationContext): Promise<CallToolResult> {
    try {
      await ctx.manager.delete(args.id);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: "Document deleted successfully",
            id: args.id,
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

export const deleteOp = new DeleteOp();

const linkArgsSchema = z.object({
  id: z.string().describe("Document ID to link"),
  parent_id: z.string().describe("Parent document ID"),
});
type LinkArgs = z.infer<typeof linkArgsSchema>;

export class LinkOp implements Operation<LinkArgs> {
  readonly id = "link";
  readonly summary = "Link document to a parent";
  readonly detail = `Add a dependency link from an existing document to a parent.
Validates that the parent type is allowed for this document type.

Examples:
  operation: "link"
  params: { id: "01HQXK3V7M...", parent_id: "01HQXK2A8N..." }`;
  readonly argsSchema = linkArgsSchema;
  async execute(args: LinkArgs, ctx: OperationContext): Promise<CallToolResult> {
    try {
      const doc = await ctx.manager.link({ id: args.id, parentId: args.parent_id });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: "Document linked successfully",
            document: {
              id: doc.id,
              type: doc.type,
              title: doc.title,
              requires: doc.requires,
            },
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

export const linkOp = new LinkOp();

export const mutateOperations = [createOp, updateOp, deleteOp, linkOp];
