import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import type { ChainManager } from "../../chain-manager.js";
import {
  allQueryOperations,
  allMutateOperations,
  getQueryOperation,
  getMutateOperation,
} from "../../operations/registry.js";

const DescribeSchema = z.object({
  operation: z.string().optional().describe("Operation ID for details (omit for full list)"),
});

type DescribeArgs = z.infer<typeof DescribeSchema>;

export class ChainDescribeHandler extends BaseToolHandler<DescribeArgs> {
  readonly name = "chain_describe";
  readonly description = "List available operations and configured types. Use without arguments to see all operations, or specify an operation ID for details.";
  readonly schema = DescribeSchema;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      operation: {
        type: "string",
        description: "Operation ID for details (omit for full list)",
      },
    },
  };

  constructor(private readonly manager: ChainManager) {
    super();
  }

  protected async doExecute(args: DescribeArgs): Promise<ToolResponse> {
    const { operation } = args;

    // Guide mode - show best practices
    if (operation === "guide") {
      return {
        content: [{ type: "text", text: this.getGuideContent() }],
      };
    }

    // Detail mode
    if (operation) {
      const queryOp = getQueryOperation(operation);
      const mutateOp = getMutateOperation(operation);
      const op = queryOp ?? mutateOp;

      if (!op) {
        const available = [
          ...allQueryOperations.map(o => o.id),
          ...allMutateOperations.map(o => o.id),
          "guide",
        ].join(", ");
        return {
          content: [{ type: "text", text: `Unknown operation: "${operation}"\n\nAvailable operations: ${available}` }],
          isError: true,
        };
      }

      const jsonSchema = zodToJsonSchema(op.argsSchema, { target: "openApi3" });
      const category = queryOp ? "Query (no approval)" : "Mutate (approval required)";

      const lines = [
        `## ${op.id}`,
        ``,
        `**Category:** ${category}`,
        ``,
        `Use \`chain_${queryOp ? "query" : "mutate"}({ operation: "${op.id}", params: {...} })\` to execute.`,
        ``,
        op.detail,
        ``,
        `**Parameters (JSON Schema):**`,
        "```json",
        JSON.stringify(jsonSchema, null, 2),
        "```",
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }

    // List mode
    const types = this.manager.getTypes();
    const rootTypes = this.manager.getRootTypes();

    const lines = [
      `# Traceable Chain`,
      ``,
      `## Configured Types`,
      ``,
    ];

    for (const [typeName, cfg] of Object.entries(types)) {
      const isRoot = rootTypes.includes(typeName);
      const requires = cfg.requires === null
        ? "(root)"
        : Array.isArray(cfg.requires)
          ? cfg.requires.join(" | ")
          : cfg.requires;
      lines.push(`- **${typeName}**: requires ${requires}${cfg.description ? ` - ${cfg.description}` : ""}`);
    }

    lines.push("");
    lines.push(`## Query Operations (no approval)`);
    for (const op of allQueryOperations) {
      lines.push(`- **${op.id}**: ${op.summary}`);
    }

    lines.push("");
    lines.push(`## Mutate Operations (approval required)`);
    for (const op of allMutateOperations) {
      lines.push(`- **${op.id}**: ${op.summary}`);
    }

    lines.push("");
    lines.push(`Use \`chain_describe({ operation: "<id>" })\` for details.`);
    lines.push("");
    lines.push(`**Important:** Before creating documents, read \`chain_describe({ operation: "guide" })\` to understand proper chain structure.`);

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }

  private getGuideContent(): string {
    return `# Chain Structure Guide

## Core Principle

traceable-chain-mcp is designed to **trace dependencies**. When you call \`trace(direction: "up")\` from an ADR, you should be able to reach the original requirement in a single chain.

## Type Hierarchy

\`\`\`
requirement (root)
  └── spec
       └── design
            └── implementation
                 └── test

requirement | spec | design | implementation
  └── proposal
       └── adr
\`\`\`

## Common Mistake: Orphaned Requirements

### ❌ Wrong

\`\`\`
[requirement] Feature A           ← Original requirement
[requirement] Feature A details   ← Wrong: should be spec
\`\`\`

**Problem**: Tracing from "Feature A details" won't reach "Feature A".

### ✅ Correct

\`\`\`
[requirement] Feature A
  └── [spec] Feature A details    ← Connected under requirement
       └── [proposal] Implementation option
            └── [adr] Decision
\`\`\`

## Before Creating Documents

### 1. Check existing chains

\`\`\`
chain_query({ operation: "list" })
\`\`\`

### 2. Identify the parent

- **Detailing a requirement** → Create spec under existing requirement
- **Design decision** → Create design under existing spec
- **Proposing implementation** → Create proposal under requirement/spec/design
- **Recording decision** → Create adr under proposal

### 3. Verify after creation

\`\`\`
chain_query({
  operation: "trace",
  params: { id: "<adr-id>", direction: "up" }
})
\`\`\`

## When to Create New Requirement

**DO create new requirement:**
- Completely independent new feature/project
- No relation to existing chains

**DON'T create new requirement:**
- Detailing existing requirement → Use spec
- Design decision for existing feature → Use design/proposal
- ADR for existing feature → Use proposal under existing chain

## Note on requires Field

The \`requires\` field cannot be changed after creation. If you made a mistake, you must delete and recreate the document in the correct order (children first, then parents).`;
  }
}
