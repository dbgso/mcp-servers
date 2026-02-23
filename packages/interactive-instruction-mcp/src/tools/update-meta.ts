import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MarkdownReader } from "../services/markdown-reader.js";
import { wrapResponse } from "../utils/response-wrapper.js";
import { parseFrontmatter } from "../utils/frontmatter-parser.js";
import type { ReminderConfig } from "../types/index.js";

export function registerUpdateMetaTool(params: {
  server: McpServer;
  reader: MarkdownReader;
  config: ReminderConfig;
}): void {
  const { server, reader, config } = params;

  server.registerTool(
    "update_meta",
    {
      description:
        "Get a prompt to update document metadata (description and triggers/when_to_use). Returns current content and update instructions for AI to generate new metadata.",
      inputSchema: {
        id: z
          .string()
          .describe("Document ID to update metadata for"),
      },
    },
    async ({ id }) => {
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

      const frontmatter = parseFrontmatter(content);
      const currentDescription = frontmatter.description || "(Not set)";
      const currentTriggers = frontmatter.triggers?.join("\n  - ") || "(Not set)";

      const prompt = `# Metadata Update Request for: ${id}

## Current Metadata
- **description**: ${currentDescription}
- **triggers (when to use)**:
  - ${currentTriggers}

## Document Content
\`\`\`markdown
${content}
\`\`\`

## Task
Please analyze the document content above and generate updated metadata:

1. **description**: A concise 1-2 sentence summary of what this document is about.
   - Should clearly describe the purpose and content
   - Write in third person
   - Keep it under 150 characters

2. **triggers (when to use)**: List specific situations when this document should be referenced.
   - Use action-oriented phrases
   - Be specific about the context/trigger
   - Include 2-5 items

## Output Format
After analysis, call \`draft update\` with the updated frontmatter:

\`\`\`markdown
---
description: [Your new description here]
triggers:
  - [Trigger 1]
  - [Trigger 2]
  - [Trigger 3]
---

[Rest of document content unchanged]
\`\`\``;

      return wrapResponse({
        result: {
          content: [
            {
              type: "text" as const,
              text: prompt,
            },
          ],
        },
        config,
      });
    }
  );
}
