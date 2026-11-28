import type { BuildSpecParams, Layout } from "./types.js";
import type { LayoutName } from "../types.js";

/**
 * The parts of a layout that are the same for almost all of them.
 *
 * A layout built into cytoscape needs no scripts; only the ones provided by an
 * extension override these.
 */
export abstract class BaseLayout implements Layout {
  readonly scriptUrls: readonly string[] = [];
  readonly requiresPositions: boolean = false;

  /**
   * Whether this layout reads node dimensions from `layoutDimensions()`, and so
   * has to be told that a node's size includes its label.
   *
   * True for the layouts descended from `layout-base` -- cose, fcose, cola,
   * cise, avsdf -- which default `nodeDimensionsIncludeLabels` to false and
   * would otherwise lay out a node's body without the padding around its
   * label.
   *
   * On its own this option fixes nothing. It was the fix proposed for the
   * overlapping-nodes bug (#46) and, measured on that graph, it moved 501
   * overlapping node pairs to 437 -- because the dimensions it selects between
   * were both wrong. What actually mattered is in
   * `renderers/html/document.ts`: the node had no resolved width at layout
   * time. This is set because 331x40 is the node a person sees, so it is the
   * node the layout should place; it is not what cured the bug.
   */
  readonly sizesNodesByLabel: boolean = false;

  abstract readonly name: LayoutName;

  /** Defaults to our own name, which is what cytoscape knows for most of them. */
  get cytoscapeName(): string {
    return this.name;
  }

  abstract buildSpec(params: BuildSpecParams): Record<string, unknown>;
}
