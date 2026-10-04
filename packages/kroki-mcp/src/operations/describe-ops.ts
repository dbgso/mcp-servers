import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Operation } from "./types.js";
import { getAllTools, getTool, useCaseRecommendations } from "../diagrams/registry.js";
import { getGuidelines } from "../diagrams/guidelines/index.js";
import type { ToolGuidelines } from "../diagrams/guidelines/index.js";
import type { DiagramTool, SubDiagram } from "../diagrams/types.js";

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

const bullets = (items: string[]): string[] => items.map(item => `- ${item}`);

/**
 * Generate detailed guidelines for a specific tool
 */
function generateToolGuide({ toolId, subDiagramId }: { toolId: string; subDiagramId?: string }): string {
  const tool = getTool(toolId);
  if (!tool) {
    return `Unknown tool: "${toolId}". Use kroki_describe() to see available tools.`;
  }

  const guidelines = getGuidelines(toolId);
  const body = guidelines
    ? guidedToolGuide({ tool, guidelines, subDiagramId })
    : registryToolGuide({ tool, subDiagramId });

  return [...body, "", "---", "", `**Render:** \`kroki_render({ tool: '${toolId}', diagram: '...' })\``].join("\n");
}

/**
 * A tool with a hand-written guideline module: its overview, its guide for one
 * sub-diagram, or -- for a sub-diagram the module does not cover -- what the
 * registry knows about it
 */
function guidedToolGuide(params: {
  tool: DiagramTool;
  guidelines: ToolGuidelines;
  subDiagramId: string | undefined;
}): string[] {
  const { tool, guidelines, subDiagramId } = params;
  if (!subDiagramId) {
    return guidelinesOverview({ tool, guidelines });
  }

  const subGuide = guidelines.subDiagrams[subDiagramId];
  if (!subGuide) {
    return registrySubDiagram({
      tool,
      subDiagramId,
      heading: "##",
      title: (sub) => [`# ${tool.name} - ${sub.name}`, ""],
    });
  }

  return [
    `# ${tool.name} - ${subDiagramId}`,
    "",
    subGuide.syntax,
    "",
    "## Best Practices",
    "",
    ...bullets(subGuide.bestPractices),
    "",
    "---",
    "",
    "## References",
    ...bullets(guidelines.references),
  ];
}

/** The guideline module's overview and the tool's sub-diagrams. */
function guidelinesOverview({ tool, guidelines }: { tool: DiagramTool; guidelines: ToolGuidelines }): string[] {
  return [
    `# ${tool.name} Guidelines`,
    "",
    `**Website:** ${tool.website}`,
    "",
    guidelines.overview,
    "",
    "---",
    "",
    "## Available Sub-Diagrams",
    "",
    "Use `kroki_describe({ tool: '" + tool.id + "', subDiagram: '<type>' })` for detailed syntax.",
    "",
    ...tool.subDiagrams.map((sub) => {
      const hasDetailedGuide = guidelines.subDiagrams[sub.id] ? " (detailed guide available)" : "";
      return `- **${sub.id}**: ${sub.description}${hasDetailedGuide}`;
    }),
    "",
    "---",
    "",
    "## References",
    ...bullets(guidelines.references),
  ];
}

/**
 * A tool known only from the registry: its description, strengths and
 * weaknesses, then one sub-diagram or all of them
 */
function registryToolGuide({ tool, subDiagramId }: { tool: DiagramTool; subDiagramId: string | undefined }): string[] {
  const header = [
    `# ${tool.name} Guidelines`,
    "",
    tool.description,
    "",
    `**Website:** ${tool.website}`,
    "",
    "## Strengths",
    ...bullets(tool.strengths),
    "",
    "## Weaknesses",
    ...bullets(tool.weaknesses),
    "",
  ];

  if (!subDiagramId) {
    return [...header, ...allSubDiagrams(tool)];
  }

  return [
    ...header,
    ...registrySubDiagram({
      tool,
      subDiagramId,
      heading: "###",
      title: (sub) => ["---", "", `## ${sub.name}`, ""],
    }),
  ];
}

/** Every sub-diagram with its example, then the tool's general best practices. */
function allSubDiagrams(tool: DiagramTool): string[] {
  return [
    "## Sub-Diagram Types",
    "",
    ...tool.subDiagrams.flatMap((sub) => [
      `### ${sub.name} (\`${sub.id}\`)`,
      "",
      sub.description,
      "",
      "```" + tool.id,
      sub.example,
      "```",
      "",
    ]),
    "---",
    "",
    "## General Best Practices",
    "",
    generateBestPractices(tool.id),
  ];
}

/**
 * One sub-diagram as the registry describes it -- description, example and
 * best practices, under headings of the given depth -- or, when the tool has no
 * such sub-diagram, the ones it does have
 */
function registrySubDiagram(params: {
  tool: DiagramTool;
  subDiagramId: string;
  heading: string;
  title: (sub: SubDiagram) => string[];
}): string[] {
  const { tool, subDiagramId, heading, title } = params;
  const sub = tool.subDiagrams.find(s => s.id === subDiagramId);
  if (!sub) {
    return [`Unknown sub-diagram: "${subDiagramId}". Available: ${tool.subDiagrams.map(s => s.id).join(", ")}`];
  }

  return [
    ...title(sub),
    sub.description,
    "",
    `${heading} Example`,
    "",
    "```" + tool.id,
    sub.example,
    "```",
    "",
    `${heading} Best Practices`,
    "",
    generateBestPractices(tool.id),
  ];
}

/**
 * General best practices for tools whose sub-diagrams have no guideline module
 * entry. Advice for a single sub-diagram lives in `diagrams/guidelines/*.ts`.
 */
const GENERAL_BEST_PRACTICES: Record<string, string[]> = {
  mermaid: [
    "Use clear, descriptive node labels",
    "Keep diagrams focused - split large diagrams",
    "Use subgraphs for logical grouping",
    "Prefer TD (top-down) or LR (left-right) direction for readability",
  ],
  plantuml: [
    "Always wrap in @startuml/@enduml",
    "Use `skinparam` for consistent styling",
    "Use `!define` for reusable components",
    "Add `hide empty members` to reduce clutter",
  ],
  d2: [
    "Use containers for logical grouping: `server: { ... }`",
    "Apply icons with `icon` keyword",
    "Use `shape` for different node types",
    "Connection labels: `a -> b: label`",
  ],
  graphviz: [
    "Use `rankdir=LR` or `rankdir=TB` for direction",
    "Group with `subgraph cluster_name`",
    "Style edges: `[style=dashed, color=red]`",
    "Use `rank=same` to align nodes",
  ],
  structurizr: [
    "Follow C4 model hierarchy: Context > Container > Component > Code",
    "Define model first, then views",
    "Use consistent naming conventions",
    "Add descriptions to all elements",
  ],
};

/** For a tool with no practices of its own. */
const FALLBACK_BEST_PRACTICES = [
  "Keep diagrams simple and focused",
  "Use clear, descriptive labels",
  "Follow tool-specific conventions",
];

/**
 * Generate best practices for a tool
 */
function generateBestPractices(toolId: string): string {
  return bullets(GENERAL_BEST_PRACTICES[toolId] ?? FALLBACK_BEST_PRACTICES).join("\n");
}

export class DescribeOperation implements Operation<DescribeArgs> {
  readonly id = "list";
  readonly summary = "List diagram tools or get detailed guidelines";
  readonly detail = `Without arguments: Lists all available diagram tools with use case recommendations.
With tool argument: Returns detailed guidelines for that specific tool.
With tool and subDiagram: Returns focused guide for that diagram type.`;
  readonly argsSchema = DescribeArgsSchema;
  async execute(args: DescribeArgs): Promise<CallToolResult> {
    const { tool, subDiagram } = args;

    let text: string;
    if (tool) {
      text = generateToolGuide({ toolId: tool, subDiagramId: subDiagram });
    } else {
      text = generateOverview();
    }

    return {
      content: [{ type: "text", text }],
    };
  }
}

export const describeOperation = new DescribeOperation();
