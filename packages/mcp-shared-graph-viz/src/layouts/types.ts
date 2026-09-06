import type { LayoutOptions, LayoutName, Point } from "../types.js";

/** The cytoscape layout configuration embedded in a rendered page. */
export interface LayoutSpec {
  /** The name cytoscape resolves, not necessarily ours. */
  name: string;
  [key: string]: unknown;
}

export interface BuildSpecParams {
  options: LayoutOptions;
  /** Node separation multiplier, already defaulted. */
  spacing: number;
  /** Positions for the layouts that place nodes where the caller says. */
  positions: Map<string, Point>;
  /**
   * Node ids grouped by the caller's `group`, for the layouts that arrange
   * clusters rather than individual nodes.
   */
  clusters: string[][];
}

/**
 * One layout, and everything that differs between layouts.
 *
 * Adding a layout means adding a file here and one entry in the registry.
 * Nothing else in the package branches on the layout name.
 */
export interface Layout {
  readonly name: LayoutName;
  /**
   * The name cytoscape registered the layout under.
   *
   * Usually the same, but one extension can provide several of our layouts —
   * ELK registers itself once as `elk` and picks its algorithm from options.
   */
  readonly cytoscapeName: string;
  /**
   * Scripts the page must load for this layout. Most need none.
   *
   * An extension registers itself with cytoscape as it loads, so nothing has
   * to call `cytoscape.use`; the page only has to fetch these in order.
   */
  readonly scriptUrls: readonly string[];
  /** Whether every node must carry a position for this layout to make sense. */
  readonly requiresPositions: boolean;
  /** The options this layout adds on top of the shared base. */
  buildSpec(params: BuildSpecParams): Record<string, unknown>;
}
