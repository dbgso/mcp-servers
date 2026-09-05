import type { LayoutOptions, LayoutName, Point } from "../types.js";

/** The cytoscape layout configuration embedded in a rendered page. */
export interface LayoutSpec {
  name: LayoutName;
  [key: string]: unknown;
}

export interface BuildSpecParams {
  options: LayoutOptions;
  /** Node separation multiplier, already defaulted. */
  spacing: number;
  /** Positions for the layouts that place nodes where the caller says. */
  positions: Map<string, Point>;
}

/**
 * One layout, and everything that differs between layouts.
 *
 * Adding a layout means adding a file here and one entry in the registry.
 * Nothing else in the package branches on the layout name.
 */
export interface Layout {
  readonly name: LayoutName;
  /** Scripts the page must load for this layout. Most need none. */
  readonly scriptUrls: readonly string[];
  /** Whether every node must carry a position for this layout to make sense. */
  readonly requiresPositions: boolean;
  /** The options this layout adds on top of the shared base. */
  buildSpec(params: BuildSpecParams): Record<string, unknown>;
}
