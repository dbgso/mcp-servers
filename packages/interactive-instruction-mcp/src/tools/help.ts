import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MarkdownReader } from "../services/markdown-reader.js";
import { wrapResponse } from "../utils/response-wrapper.js";
import type { ReminderConfig, MarkdownSummary } from "../types/index.js";
import { DRAFT_DIR } from "../constants.js";

export function registerHelpTool(params: {
  server: McpServer;
  reader: MarkdownReader;
  config: ReminderConfig;
}): void {
  const { server, reader, config } = params;
  server.registerTool(
    "help",
    {
      description:
        "List or read documentation. Call without args to list all docs. Call with id to read specific doc.",
      inputSchema: {
        id: z
          .string()
          .optional()
          .describe(
            "Document ID (filename without .md extension). Use '__' for hierarchy (e.g., 'git__workflow' for git/workflow.md). If ID is a category, lists its contents."
          ),
        recursive: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "If true, show all documents including nested ones. If false (default), show one level at a time with categories."
          ),
        query: z
          .string()
          .optional()
          .describe(
            "Search query for filtering by description or whenToUse (case-insensitive partial match). Implicitly enables recursive mode."
          ),
        missingMeta: z
          .enum(["description", "whenToUse", "any"])
          .optional()
          .describe(
            "Find documents with missing metadata. 'description' = no description, 'whenToUse' = no whenToUse, 'any' = missing either. Implicitly enables recursive mode."
          ),
      },
    },
    async ({ id, recursive, query, missingMeta }) => {
      // Helper to filter out drafts
      const filterDrafts = (result: {
        documents: MarkdownSummary[];
        categories: { id: string; docCount: number }[];
      }) => ({
        documents: result.documents.filter(
          (d) => !d.id.startsWith(DRAFT_DIR)
        ),
        categories: result.categories.filter((c) => c.id !== DRAFT_DIR),
      });

      // Helper to check if document matches query
      const matchesQuery = (doc: MarkdownSummary, q: string): boolean => {
        const lowerQuery = q.toLowerCase();
        if (doc.description.toLowerCase().includes(lowerQuery)) return true;
        if (doc.whenToUse?.some(w => w.toLowerCase().includes(lowerQuery))) return true;
        return false;
      };

      // Helper to check if document has missing metadata
      const hasMissingMeta = (doc: MarkdownSummary, type: "description" | "whenToUse" | "any"): boolean => {
        const noDescription = !doc.description || doc.description.trim() === "";
        const noWhenToUse = !doc.whenToUse || doc.whenToUse.length === 0;

        switch (type) {
          case "description": return noDescription;
          case "whenToUse": return noWhenToUse;
          case "any": return noDescription || noWhenToUse;
        }
      };

      // If query or missingMeta is specified, do filtered search
      if (query || missingMeta) {
        // Always use recursive mode for search
        const result = await reader.listDocuments({ parentId: id || undefined, recursive: true });
        let { documents } = filterDrafts(result);

        if (query) {
          documents = documents.filter(d => matchesQuery(d, query));
        }
        if (missingMeta) {
          documents = documents.filter(d => hasMissingMeta(d, missingMeta));
        }

        const headerParts: string[] = [];
        if (query) headerParts.push(`query: "${query}"`);
        if (missingMeta) headerParts.push(`missing: ${missingMeta}`);
        const header = `Search results (${headerParts.join(", ")}): ${documents.length} found\n\n`;

        return wrapResponse({
          result: {
            content: [
              {
                type: "text" as const,
                text: header + reader.formatDocumentList({ documents, categories: [] }),
              },
            ],
          },
          config,
        });
      }

      // If no ID, list documents at root level
      if (id === undefined || id === "") {
        const result = await reader.listDocuments({ recursive });
        const { documents, categories } = filterDrafts(result);
        return wrapResponse({
          result: {
            content: [
              {
                type: "text" as const,
                text: reader.formatDocumentList({ documents, categories }),
              },
            ],
          },
          config,
        });
      }

      // Check if ID is a category (directory)
      const isCategory = await reader.isCategory(id);
      if (isCategory) {
        const result = await reader.listDocuments({ parentId: id, recursive });
        const { documents, categories } = filterDrafts(result);
        return wrapResponse({
          result: {
            content: [
              {
                type: "text" as const,
                text: reader.formatDocumentList({ documents, categories }),
              },
            ],
          },
          config,
        });
      }

      // Try to get document content
      const content = await reader.getDocumentContent(id);
      if (content === null) {
        return wrapResponse({
          result: {
            content: [
              {
                type: "text" as const,
                text: `Error: Document "${id}" not found.`,
              },
            ],
            isError: true,
          },
          config,
        });
      }
      return wrapResponse({
        result: {
          content: [{ type: "text" as const, text: content }],
        },
        config,
      });
    }
  );
}
