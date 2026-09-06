import { BaseLayout } from "./base.js";
import type { BuildSpecParams } from "./types.js";

/** Three deep: layout-base under cose-base under the extension. */
export const FCOSE_SCRIPT_URLS = [
  "https://cdn.jsdelivr.net/npm/layout-base@2.0.1/layout-base.js",
  "https://cdn.jsdelivr.net/npm/cose-base@2.2.0/cose-base.js",
  "https://cdn.jsdelivr.net/npm/cytoscape-fcose@2.2.0/cytoscape-fcose.js",
] as const;

/** cose reworked: faster on large graphs and steadier between runs. */
export class FcoseLayout extends BaseLayout {
  readonly name = "fcose";
  override readonly scriptUrls = FCOSE_SCRIPT_URLS;
  override readonly pluginGlobals = ["cytoscapeFcose"] as const;

  buildSpec(params: BuildSpecParams): Record<string, unknown> {
    const { spacing } = params;
    return {
      quality: "default",
      nodeRepulsion: 4500 * spacing,
      idealEdgeLength: 60 * spacing,
      nodeSeparation: 75 * spacing,
    };
  }
}
