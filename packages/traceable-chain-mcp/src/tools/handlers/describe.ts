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

    const lines = [
      `# Traceable Chain`,
      ``,
      `## Configured Types`,
      ``,
    ];

    for (const [typeName, cfg] of Object.entries(types)) {
      const requires = cfg.requires === null
        ? "(root)"
        : Array.isArray(cfg.requires)
          ? cfg.requires.join(" | ")
          : cfg.requires;
      const extras = [
        cfg.realizedBy ? `realized by ${cfg.realizedBy}` : "",
        cfg.bindsCode ? "binds code" : "",
      ].filter(Boolean).join(", ");
      lines.push(`- **${typeName}**: requires ${requires}${extras ? ` (${extras})` : ""}${cfg.description ? ` - ${cfg.description}` : ""}`);
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
    return GUIDE;
  }
}

const GUIDE = `# Chain Structure Guide

## Core Principle

Decisions are always made from the top. A philosophy decides requirements, a
requirement decides specs, a spec decides designs, a design decides the
implementation, and the implementation is bound to code. Every document links to
the parent(s) it was derived from, so \`trace(direction: "up")\` from any document
reaches the philosophy it serves.

## Type Hierarchy (default)

\`\`\`
philosophy (root)
  └── requirement
       └── spec
            └── design
                 └── implementation ──▶ code (bind_code)
spec | design
  └── test ──▶ test code
philosophy | requirement | spec | design | implementation
  └── proposal
       └── adr
\`\`\`

## Change Workflow

Every link remembers what both ends said when it was last confirmed. When either
end changes, \`check\` flags the link. Nothing is cleared until a person decides.

1. **Before a change**: \`chain_query({ operation: "impact", params: { id } })\`
   (or \`{ path }\` for code) shows what it must still satisfy and what it can break.
2. **After a change**: \`chain_query({ operation: "check" })\`.
3. **Walk up**: take an escalation with \`actionable: true\`. Re-read the drifted
   document against its parent.
   - It still holds → \`chain_mutate({ operation: "confirm", params: { id } })\`.
   - It does not → the parent is wrong. Update the parent; that is now drift one
     level up. Repeat until a level holds or the root is reached.
4. **Walk down**: every document you changed made its children \`parent_changed\`.
   Re-read and confirm or update each, top-down, until the code.
5. Repeat \`check\` until it is clean.

A code change follows the same path: \`code_changed\` on the implementation, then
design, spec, requirement, philosophy as far as the change reaches.

\`confirm\` refuses while anything above the document is unresolved, and names
it. This is what makes the walk top-down: the upper decision is settled first.

## Common Mistake: Orphaned Requirements

### ❌ Wrong

\`\`\`
[requirement] Feature A           ← Original requirement
[requirement] Feature A details   ← Wrong: should be spec
\`\`\`

**Problem**: Tracing from "Feature A details" won't reach "Feature A".

### ✅ Correct

\`\`\`
[philosophy] Why the product exists
  └── [requirement] Feature A
       └── [spec] Feature A details
            └── [proposal] Implementation option
                 └── [adr] Decision
\`\`\`

## Before Creating Documents

1. \`chain_query({ operation: "list" })\` to see existing chains.
2. Identify the parent: detailing a requirement → spec under it; a design
   decision → design under the spec; implementation → implementation under the
   design, then \`bind_code\` it.
3. \`trace(direction: "up")\` after creating to verify the chain.

## When to Create New Requirement

**DO create new requirement:**
- A new thing that must be true, derived from an existing philosophy

**DON'T create new requirement:**
- Detailing existing requirement → Use spec
- Design decision for existing feature → Use design/proposal
- ADR for existing feature → Use proposal under existing chain

## Note on requires Field

A document can have several parents. \`link\` adds one (confirmed as it is made),
\`unlink\` removes one; a non-root document always keeps at least one. To move a
document, link the new parent first, then unlink the old one.

## Adopting Existing Documents

Documents written before baselines existed report \`unreviewed_link\`. Run
\`chain_mutate({ operation: "baseline" })\` once to accept the current state.`;
