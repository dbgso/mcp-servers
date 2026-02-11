/**
 * Diagram category for use case matching
 */
export type DiagramCategory =
  | "flowchart"
  | "sequence"
  | "class"
  | "state"
  | "er"
  | "architecture"
  | "gantt"
  | "mindmap"
  | "network"
  | "process"
  | "general";

/**
 * Sub-diagram type within a tool (e.g., mermaid has flowchart, sequence, etc.)
 */
export interface SubDiagram {
  id: string;
  name: string;
  category: DiagramCategory;
  description: string;
  example: string;
}

/**
 * Main diagram tool definition
 */
export interface DiagramTool {
  id: string;
  name: string;
  description: string;
  website: string;
  strengths: string[];
  weaknesses: string[];
  bestFor: DiagramCategory[];
  subDiagrams: SubDiagram[];
}

/**
 * Detailed guidelines for a diagram tool
 */
export interface DiagramGuidelines {
  toolId: string;
  overview: string;
  syntax: {
    basics: string;
    tips: string[];
  };
  subDiagrams: {
    id: string;
    fullGuide: string;
    bestPractices: string[];
    examples: { description: string; code: string }[];
  }[];
  commonMistakes: string[];
  references: string[];
}

/**
 * Use case recommendation
 */
export interface UseCaseRecommendation {
  useCase: string;
  category: DiagramCategory;
  recommended: {
    toolId: string;
    subDiagramId?: string;
    reason: string;
  }[];
}
