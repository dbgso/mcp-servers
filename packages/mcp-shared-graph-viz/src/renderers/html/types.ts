import type { RenderParams } from "../types.js";

/** The HTML page's own options, on top of what every renderer takes. */
export interface RenderGraphHtmlParams extends RenderParams {
  /** cytoscape script URL embedded in the page. */
  cytoscapeUrl?: string;
  /**
   * Overrides the scripts the chosen layout needs, for an offline or
   * self-hosted copy. Only dagre needs any.
   */
  layoutScriptUrls?: string[];
}
