import { BaseLayout } from "./base.js";
import type { BuildSpecParams } from "./types.js";

export const CISE_SCRIPT_URLS = [
  "https://cdn.jsdelivr.net/npm/layout-base@1.0.2/layout-base.js",
  "https://cdn.jsdelivr.net/npm/avsdf-base@1.0.0/avsdf-base.js",
  "https://cdn.jsdelivr.net/npm/cose-base@1.0.3/cose-base.js",
  "https://cdn.jsdelivr.net/npm/cytoscape-cise@1.0.0/cytoscape-cise.js",
] as const;

/**
 * A circle per cluster.
 *
 * Clusters come from the caller's `group`, so this is the layout that makes a
 * grouping visible as shape rather than only as colour.
 */
export class CiseLayout extends BaseLayout {
  readonly name = "cise";
  override readonly scriptUrls = CISE_SCRIPT_URLS;

  buildSpec(params: BuildSpecParams): Record<string, unknown> {
    const { spacing, clusters } = params;
    return {
      clusters,
      nodeSeparation: 12.5 * spacing,
      idealInterClusterEdgeLengthCoefficient: 1.4 * spacing,
      allowNodesInsideCircle: false,
    };
  }
}
