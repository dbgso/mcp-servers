import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Operation } from "./types.js";

export const createOp: Operation = {
  id: "create",
  summary: "Create a new document",
  detail: `Create a new document with enforced dependency.
The 'requires' field is mandatory for non-root types.

Examples:
  operation: "create"
  params: { type: "requirement", title: "User Auth", content: "..." }
  params: { type: "spec", requires: "01HQXK2A8N...", title: "Auth Spec", content: "..." }`,
  argsSchema: z.object({
    type: z.string().describe("Document type"),
    requires: z.string().optional().describe("Parent document ID (required for non-root types)"),
    title: z.string().describe("Document title"),
    content: z.string().describe("Document content (markdown)"),
  }),
  execute: async (args, ctx): Promise<CallToolResult> => {
    try {
      const doc = await ctx.manager.create(args.type, args.title, args.content, args.requires);
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
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  },
};

export const updateOp: Operation = {
  id: "update",
  summary: "Update a document",
  detail: `Update an existing document's title or content.
The document type and dependencies cannot be changed.

Examples:
  operation: "update"
  params: { id: "01HQXK3V7M...", title: "New Title" }
  params: { id: "01HQXK3V7M...", content: "Updated content..." }`,
  argsSchema: z.object({
    id: z.string().describe("Document ID to update"),
    title: z.string().optional().describe("New title"),
    content: z.string().optional().describe("New content"),
  }),
  execute: async (args, ctx): Promise<CallToolResult> => {
    try {
      const doc = await ctx.manager.update(args.id, {
        title: args.title,
        content: args.content,
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
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  },
};

export const deleteOp: Operation = {
  id: "delete",
  summary: "Delete a document",
  detail: `Delete a document. Will fail if other documents depend on it.

Examples:
  operation: "delete"
  params: { id: "01HQXK3V7M..." }`,
  argsSchema: z.object({
    id: z.string().describe("Document ID to delete"),
  }),
  execute: async (args, ctx): Promise<CallToolResult> => {
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
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  },
};

export const linkOp: Operation = {
  id: "link",
  summary: "Link document to a parent",
  detail: `Add a dependency link from an existing document to a parent.
Validates that the parent type is allowed for this document type.

Examples:
  operation: "link"
  params: { id: "01HQXK3V7M...", parent_id: "01HQXK2A8N..." }`,
  argsSchema: z.object({
    id: z.string().describe("Document ID to link"),
    parent_id: z.string().describe("Parent document ID"),
  }),
  execute: async (args, ctx): Promise<CallToolResult> => {
    try {
      const doc = await ctx.manager.link(args.id, args.parent_id);
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
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  },
};

export const mutateOperations: Operation[] = [createOp, updateOp, deleteOp, linkOp];
