/**
 * The page's own settings.
 *
 * Given when the renderer is built, so `Renderer.render` keeps the shared
 * signature. `renderHtml` also accepts them per call, for callers that know
 * they want HTML and never go through a renderer.
 */
export interface HtmlRendererOptions {
  /** cytoscape script URL embedded in the page. */
  cytoscapeUrl?: string;
  /**
   * Overrides the scripts the chosen layout needs, for an offline or
   * self-hosted copy. Only dagre needs any.
   */
  layoutScriptUrls?: string[];
}
