import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions, textResponse } from "../types.js";
import { parseFrontmatter } from "../../../utils/frontmatter-parser.js";

const schema = z.object({
  action: z.literal("update_meta"),
  id: z.string().describe("Document ID to update metadata for"),
});

type Args = z.infer<typeof schema>;


export class UpdateMetaHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "update_meta";
  readonly help = "Read a document's content and generate a prompt for updating its metadata (description, whenToUse).";
  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id } = params.args;
    const { reader } = params.context;

    const content = await reader.getDocumentContent(id);
    if (content === null) {
      return errorResponse(`Error: Document "${id}" not found.` +
        formatNextActions([{
          action: "list",
          description: "View all documents",
          example: `instruction(action: "list")`,
        }]));
    }

    const frontmatter = parseFrontmatter(content);
    const currentDescription = frontmatter.description || "(Not set)";
    const currentWhenToUse = frontmatter.whenToUse?.join("\n  - ") || "(Not set)";

    const prompt = `# Metadata Update Request for: ${id}

## Current Metadata
- **description**: ${currentDescription}
- **whenToUse**:
  - ${currentWhenToUse}

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

2. **whenToUse**: List specific situations when this document should be referenced.
   - Use action-oriented phrases
   - Be specific about the context/trigger
   - Include 2-5 items

## Output Format
After analysis, call \`instruction(action: "update", ...)\` with the updated frontmatter:

\`\`\`
instruction(action: "update", id: "${id}", content: "---\\ndescription: ...\\nwhenToUse:\\n  - ...\\n---\\n\\n[content]")
\`\`\``;

    return textResponse(
      prompt +
      formatNextActions([{
        action: "update",
        description: "Apply updated metadata",
        example: `instruction(action: "update", id: "${id}", content: "---\\ndescription: ...\\nwhenToUse:\\n  - ...\\n---\\n\\n...")`,
      }]),
    );
  }
}
