import { BaseLayout } from "./base.js";
import type { BuildSpecParams } from "./types.js";

export const AVSDF_SCRIPT_URLS = [
  "https://cdn.jsdelivr.net/npm/layout-base@1.0.2/layout-base.js",
  "https://cdn.jsdelivr.net/npm/avsdf-base@1.0.0/avsdf-base.js",
  "https://cdn.jsdelivr.net/npm/cytoscape-avsdf@1.0.0/cytoscape-avsdf.js",
] as const;

/** One circle, ordered to keep edge crossings down. */
export class AvsdfLayout extends BaseLayout {
  readonly name = "avsdf";
  override readonly scriptUrls = AVSDF_SCRIPT_URLS;

  buildSpec(params: BuildSpecParams): Record<string, unknown> {
    return { nodeSeparation: 60 * params.spacing };
  }
}
