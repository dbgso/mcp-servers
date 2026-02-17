import type { ToolResult, DraftActionHandler, DraftActionParams, DraftActionContext } from "../../../types/index.js";
import { DRAFT_PREFIX } from "../../../constants.js";

export class AddHandler implements DraftActionHandler {
  async execute(params: {
    actionParams: DraftActionParams;
    context: DraftActionContext;
  }): Promise<ToolResult> {
    const { id, content } = params.actionParams;
    const { reader } = params.context;

    if (!id || !content) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: id and content are required for add action",
          },
        ],
        isError: true,
      };
    }
    const draftId = DRAFT_PREFIX + id;
    const result = await reader.addDocument({ id: draftId, content });
    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `Draft "${id}" created successfully.
Path: ${result.path}

---

## [AI Action Required]

**You MUST do the following before proceeding:**

1. **Explain the content** - Summarize what this draft contains
2. **Show the file path** - User needs to know where to review: \`${result.path}\`
3. **Wait for user confirmation** - Do NOT apply until user reviews and approves

**Example response:**
\`\`\`
Created draft for [topic].

**Contents:**
- [Key point 1]
- [Key point 2]

**File:** ${result.path}

Please review and let me know if you want to apply this or make changes.
\`\`\``,
        },
      ],
    };
  }
}
