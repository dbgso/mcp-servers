import { BaseLayout } from "./base.js";
import type { BuildSpecParams } from "./types.js";

export const COLA_SCRIPT_URLS = [
  "https://cdn.jsdelivr.net/npm/webcola@3.4.0/WebCola/cola.min.js",
  "https://cdn.jsdelivr.net/npm/cytoscape-cola@2.5.1/cytoscape-cola.js",
] as const;

/** Constraint-based force layout; keeps nodes from overlapping. */
export class ColaLayout extends BaseLayout {
  readonly name = "cola";
  override readonly scriptUrls = COLA_SCRIPT_URLS;
  override readonly pluginGlobals = ["cytoscapeCola"] as const;

  buildSpec(params: BuildSpecParams): Record<string, unknown> {
    const { spacing } = params;
    return {
      edgeLength: 90 * spacing,
      nodeSpacing: 12 * spacing,
      avoidOverlap: true,
      maxSimulationTime: 2000,
    };
  }
}
