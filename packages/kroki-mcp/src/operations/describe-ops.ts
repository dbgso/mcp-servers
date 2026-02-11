import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Operation } from "./types.js";
import { getAllTools, getTool, useCaseRecommendations } from "../diagrams/registry.js";
import { getGuidelines } from "../diagrams/guidelines/index.js";

const DescribeArgsSchema = z.object({
  tool: z.string().optional().describe("Diagram tool ID (e.g., 'mermaid', 'plantuml', 'd2')"),
  subDiagram: z.string().optional().describe("Sub-diagram type within the tool"),
});

type DescribeArgs = z.infer<typeof DescribeArgsSchema>;

/**
 * Generate overview of all tools and use cases
 */
function generateOverview(): string {
  const tools = getAllTools();

  const lines = [
    "# Kroki Diagram Tools",
    "",
    "Kroki provides unified API for multiple diagram tools. Use `kroki_describe({ tool: '<id>' })` for detailed guidelines.",
    "",
    "## Available Tools",
    "",
  ];

  for (const tool of tools) {
    const subDiagramList = tool.subDiagrams.map(s => s.id).join(", ");
    lines.push(`### ${tool.name} (\`${tool.id}\`)`);
    lines.push("");
    lines.push(tool.description);
    lines.push("");
    lines.push(`**Best for:** ${tool.bestFor.join(", ")}`);
    lines.push("");
    lines.push(`**Sub-diagrams:** ${subDiagramList}`);
    lines.push("");
    lines.push("**Strengths:**");
    tool.strengths.forEach(s => lines.push(`- ${s}`));
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Use Case Recommendations");
  lines.push("");
  lines.push("| Use Case | Recommended Tool | Reason |");
  lines.push("|----------|------------------|--------|");

  for (const rec of useCaseRecommendations) {
    const primary = rec.recommended[0];
    const toolName = getTool(primary.toolId)?.name ?? primary.toolId;
    const subInfo = primary.subDiagramId ? ` (${primary.subDiagramId})` : "";
    lines.push(`| ${rec.useCase} | ${toolName}${subInfo} | ${primary.reason} |`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Quick Start");
  lines.push("");
  lines.push("1. Identify your use case from the table above");
  lines.push("2. Get detailed guidelines: `kroki_describe({ tool: 'mermaid' })`");
  lines.push("3. Render diagram: `kroki_render({ tool: 'mermaid', diagram: 'flowchart TD\\n  A-->B' })`");

  return lines.join("\n");
}

/**
 * Generate detailed guidelines for a specific tool
 */
function generateToolGuide(toolId: string, subDiagramId?: string): string {
  const tool = getTool(toolId);
  if (!tool) {
    return `Unknown tool: "${toolId}". Use kroki_describe() to see available tools.`;
  }

  const guidelines = getGuidelines(toolId);
  const lines: string[] = [];

  // If we have detailed guidelines, use them
  if (guidelines) {
    if (subDiagramId) {
      // Specific sub-diagram requested
      const subGuide = guidelines.subDiagrams[subDiagramId];
      if (subGuide) {
        lines.push(`# ${tool.name} - ${subDiagramId}`);
        lines.push("");
        lines.push(subGuide.syntax);
        lines.push("");
        lines.push("## Best Practices");
        lines.push("");
        subGuide.bestPractices.forEach(p => lines.push(`- ${p}`));
        lines.push("");
        lines.push("---");
        lines.push("");
        lines.push("## References");
        guidelines.references.forEach(ref => lines.push(`- ${ref}`));
      } else {
        // Fallback to basic info
        const sub = tool.subDiagrams.find(s => s.id === subDiagramId);
        if (sub) {
          lines.push(`# ${tool.name} - ${sub.name}`);
          lines.push("");
          lines.push(sub.description);
          lines.push("");
          lines.push("## Example");
          lines.push("");
          lines.push("```" + toolId);
          lines.push(sub.example);
          lines.push("```");
          lines.push("");
          lines.push("## Best Practices");
          lines.push("");
          lines.push(generateBestPractices(toolId, subDiagramId));
        } else {
          lines.push(`Unknown sub-diagram: "${subDiagramId}". Available: ${tool.subDiagrams.map(s => s.id).join(", ")}`);
        }
      }
    } else {
      // Full tool overview with detailed guidelines
      lines.push(`# ${tool.name} Guidelines`);
      lines.push("");
      lines.push(`**Website:** ${tool.website}`);
      lines.push("");
      lines.push(guidelines.overview);
      lines.push("");
      lines.push("---");
      lines.push("");
      lines.push("## Available Sub-Diagrams");
      lines.push("");
      lines.push("Use `kroki_describe({ tool: '" + toolId + "', subDiagram: '<type>' })` for detailed syntax.");
      lines.push("");
      for (const sub of tool.subDiagrams) {
        const hasDetailedGuide = guidelines.subDiagrams[sub.id] ? " (detailed guide available)" : "";
        lines.push(`- **${sub.id}**: ${sub.description}${hasDetailedGuide}`);
      }
      lines.push("");
      lines.push("---");
      lines.push("");
      lines.push("## References");
      guidelines.references.forEach(ref => lines.push(`- ${ref}`));
    }
  } else {
    // Fallback to basic info for tools without detailed guidelines
    lines.push(`# ${tool.name} Guidelines`);
    lines.push("");
    lines.push(tool.description);
    lines.push("");
    lines.push(`**Website:** ${tool.website}`);
    lines.push("");

    lines.push("## Strengths");
    tool.strengths.forEach(s => lines.push(`- ${s}`));
    lines.push("");

    lines.push("## Weaknesses");
    tool.weaknesses.forEach(w => lines.push(`- ${w}`));
    lines.push("");

    if (subDiagramId) {
      const sub = tool.subDiagrams.find(s => s.id === subDiagramId);
      if (sub) {
        lines.push(`---`);
        lines.push("");
        lines.push(`## ${sub.name}`);
        lines.push("");
        lines.push(sub.description);
        lines.push("");
        lines.push("### Example");
        lines.push("");
        lines.push("```" + toolId);
        lines.push(sub.example);
        lines.push("```");
        lines.push("");
        lines.push("### Best Practices");
        lines.push("");
        lines.push(generateBestPractices(toolId, subDiagramId));
      } else {
        lines.push(`Unknown sub-diagram: "${subDiagramId}". Available: ${tool.subDiagrams.map(s => s.id).join(", ")}`);
      }
    } else {
      lines.push("## Sub-Diagram Types");
      lines.push("");

      for (const sub of tool.subDiagrams) {
        lines.push(`### ${sub.name} (\`${sub.id}\`)`);
        lines.push("");
        lines.push(sub.description);
        lines.push("");
        lines.push("```" + toolId);
        lines.push(sub.example);
        lines.push("```");
        lines.push("");
      }

      lines.push("---");
      lines.push("");
      lines.push("## General Best Practices");
      lines.push("");
      lines.push(generateBestPractices(toolId));
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`**Render:** \`kroki_render({ tool: '${toolId}', diagram: '...' })\``);

  return lines.join("\n");
}

/**
 * Generate best practices for a tool/sub-diagram
 */
function generateBestPractices(toolId: string, subDiagramId?: string): string {
  const practices: Record<string, Record<string, string[]>> = {
    mermaid: {
      _general: [
        "Use clear, descriptive node labels",
        "Keep diagrams focused - split large diagrams",
        "Use subgraphs for logical grouping",
        "Prefer TD (top-down) or LR (left-right) direction for readability",
      ],
      flowchart: [
        "Use meaningful node IDs (not just A, B, C)",
        "Add labels to edges: `A -->|label| B`",
        "Use different node shapes for different types: `[rectangle]`, `{diamond}`, `(rounded)`",
        "Group related nodes with `subgraph`",
      ],
      sequence: [
        "Use `participant` to define actors upfront",
        "Use `activate`/`deactivate` to show lifeline focus",
        "Use different arrow types: `->` (solid), `-->` (dotted), `->>` (async)",
        "Add notes with `Note right of A: text`",
      ],
      classDiagram: [
        "Define class members with visibility: `+public`, `-private`, `#protected`",
        "Use relationship types: `<|--` (inheritance), `*--` (composition), `o--` (aggregation)",
        "Add cardinality: `1..*`, `0..1`",
      ],
      erDiagram: [
        "Use proper cardinality notation: `||--o{` (one-to-many)",
        "Define primary keys and attributes",
        "Keep entity names singular (Customer, not Customers)",
      ],
    },
    plantuml: {
      _general: [
        "Always wrap in @startuml/@enduml",
        "Use `skinparam` for consistent styling",
        "Use `!define` for reusable components",
        "Add `hide empty members` to reduce clutter",
      ],
      sequence: [
        "Define participants with stereotypes: `participant \"User\" as U <<Human>>`",
        "Use `autonumber` for numbered steps",
        "Group with `group`, `alt`, `opt`, `loop`",
        "Use `ref over` for references to other diagrams",
      ],
      class: [
        "Use packages to organize classes",
        "Apply stereotypes: `<<interface>>`, `<<abstract>>`",
        "Use notes: `note right of ClassName`",
      ],
    },
    d2: {
      _general: [
        "Use containers for logical grouping: `server: { ... }`",
        "Apply icons with `icon` keyword",
        "Use `shape` for different node types",
        "Connection labels: `a -> b: label`",
      ],
      containers: [
        "Nest containers for hierarchy",
        "Use `...` for internal details",
        "Reference nested elements: `parent.child`",
      ],
      sequence: [
        "Set `shape: sequence_diagram` at top",
        "Messages flow naturally top-to-bottom",
      ],
    },
    graphviz: {
      _general: [
        "Use `rankdir=LR` or `rankdir=TB` for direction",
        "Group with `subgraph cluster_name`",
        "Style edges: `[style=dashed, color=red]`",
        "Use `rank=same` to align nodes",
      ],
    },
    structurizr: {
      _general: [
        "Follow C4 model hierarchy: Context > Container > Component > Code",
        "Define model first, then views",
        "Use consistent naming conventions",
        "Add descriptions to all elements",
      ],
    },
  };

  const toolPractices = practices[toolId];
  if (!toolPractices) {
    return "- Keep diagrams simple and focused\n- Use clear, descriptive labels\n- Follow tool-specific conventions";
  }

  const general = toolPractices._general ?? [];
  const specific = subDiagramId ? (toolPractices[subDiagramId] ?? []) : [];

  const all = [...specific, ...general];
  return all.map(p => `- ${p}`).join("\n");
}

export const describeOperation: Operation<DescribeArgs> = {
  id: "list",
  summary: "List diagram tools or get detailed guidelines",
  detail: `Without arguments: Lists all available diagram tools with use case recommendations.
With tool argument: Returns detailed guidelines for that specific tool.
With tool and subDiagram: Returns focused guide for that diagram type.`,
  argsSchema: DescribeArgsSchema,
  execute: async (args): Promise<CallToolResult> => {
    const { tool, subDiagram } = args;

    let text: string;
    if (tool) {
      text = generateToolGuide(tool, subDiagram);
    } else {
      text = generateOverview();
    }

    return {
      content: [{ type: "text", text }],
    };
  },
};
