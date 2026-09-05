import { assertKnownLayout } from "./errors.js";
import type { LayoutName, LayoutOptions, Point } from "./types.js";

/**
 * The cytoscape layout configuration embedded in the page.
 *
 * The layout runs in the browser, where cytoscape can measure its own
 * container, so no bounding box is supplied and `fit` is left on.
 */
export interface LayoutSpec {
  name: LayoutName;
  [key: string]: unknown;
}

export const DEFAULT_LAYOUT: LayoutName = "dagre";
export const FIT_PADDING = 30;

export function buildLayoutSpec(params: {
  layout?: LayoutOptions;
  presetPositions?: Map<string, Point>;
}): LayoutSpec {
  const { layout, presetPositions } = params;
  const name = layout?.name ?? DEFAULT_LAYOUT;
  assertKnownLayout({ name });

  const spacing = layout?.spacing ?? 1;
  const base: LayoutSpec = {
    name,
    animate: false,
    fit: true,
    padding: FIT_PADDING,
    spacingFactor: spacing,
  };

  if (name === "dagre") {
    return {
      ...base,
      rankDir: layout?.direction ?? "TB",
      nodeSep: 40 * spacing,
      rankSep: 70 * spacing,
      edgeSep: 12 * spacing,
    };
  }
  if (name === "breadthfirst") {
    return { ...base, directed: true, grid: true };
  }
  if (name === "cose") {
    return { ...base, nodeRepulsion: 12000 * spacing, idealEdgeLength: 90 * spacing, numIter: 1000 };
  }
  if (name === "concentric") {
    return { ...base, minNodeSpacing: 30 * spacing };
  }
  if (name === "preset") {
    // Handed over explicitly rather than relying on element positions, which
    // cytoscape does not always read back from an element definition.
    return { ...base, positions: Object.fromEntries(presetPositions ?? new Map()) };
  }
  return base;
}
