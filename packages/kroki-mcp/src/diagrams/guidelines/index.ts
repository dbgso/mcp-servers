import { mermaidGuidelines } from "./mermaid.js";
import { plantumlGuidelines } from "./plantuml.js";
import { d2Guidelines } from "./d2.js";

export { mermaidGuidelines, plantumlGuidelines, d2Guidelines };

export interface ToolGuidelines {
  overview: string;
  subDiagrams: Record<string, {
    syntax: string;
    bestPractices: string[];
  }>;
  references: string[];
}

export function getGuidelines(toolId: string): ToolGuidelines | undefined {
  const guidelinesMap: Record<string, ToolGuidelines> = {
    mermaid: mermaidGuidelines as ToolGuidelines,
    plantuml: plantumlGuidelines as ToolGuidelines,
    d2: d2Guidelines as ToolGuidelines,
  };
  return guidelinesMap[toolId];
}
