import type { BuildSpecParams, Layout } from "./types.js";

/** dagre lives in a plugin, and the plugin needs dagre itself. */
export const DAGRE_SCRIPT_URLS = [
  "https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js",
  "https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.min.js",
] as const;

export class DagreLayout implements Layout {
  readonly name = "dagre";
  readonly scriptUrls = DAGRE_SCRIPT_URLS;
  readonly requiresPositions = false;

  buildSpec(params: BuildSpecParams): Record<string, unknown> {
    const { options, spacing } = params;
    return {
      rankDir: options.direction ?? "TB",
      nodeSep: 40 * spacing,
      rankSep: 70 * spacing,
      edgeSep: 12 * spacing,
    };
  }
}
