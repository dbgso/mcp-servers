import { breadthfirstLayout } from "./breadthfirst.js";
import { circleLayout, gridLayout } from "./geometric.js";
import { concentricLayout } from "./concentric.js";
import { coseLayout } from "./cose.js";
import { dagreLayout } from "./dagre.js";
import { presetLayout } from "./preset.js";
import type { Layout, LayoutSpec } from "./types.js";
import { GraphVizError } from "../errors.js";
import type { LayoutName, LayoutOptions, Point } from "../types.js";

/**
 * Every layout the library supports.
 *
 * Typed as a total map over `LayoutName`, so adding a name to the union
 * without adding its layout is a compile error rather than a runtime surprise.
 */
export const LAYOUTS: Record<LayoutName, Layout> = {
  dagre: dagreLayout,
  cose: coseLayout,
  concentric: concentricLayout,
  grid: gridLayout,
  circle: circleLayout,
  breadthfirst: breadthfirstLayout,
  preset: presetLayout,
};

export const DEFAULT_LAYOUT: LayoutName = "dagre";
export const FIT_PADDING = 30;

/** The single source of truth for which layout names exist. */
export function layoutNames(): LayoutName[] {
  return Object.keys(LAYOUTS) as LayoutName[];
}

export function resolveLayout(params: { name?: string }): Layout {
  const name = params.name ?? DEFAULT_LAYOUT;
  const layout = LAYOUTS[name as LayoutName];
  if (layout === undefined) {
    throw new GraphVizError(
      `Unknown layout "${name}". Available layouts: ${layoutNames().join(", ")}`,
    );
  }
  return layout;
}

/**
 * The layout configuration the page embeds.
 *
 * The layout runs in the browser, where cytoscape can measure its own
 * container, so it fits to that and no bounding box is supplied.
 */
export function buildLayoutSpec(params: {
  layout?: LayoutOptions;
  positions?: Map<string, Point>;
}): LayoutSpec {
  const { layout = {}, positions = new Map<string, Point>() } = params;
  const resolved = resolveLayout({ name: layout.name });
  const spacing = layout.spacing ?? 1;

  return {
    name: resolved.name,
    animate: false,
    fit: true,
    padding: FIT_PADDING,
    spacingFactor: spacing,
    ...resolved.buildSpec({ options: layout, spacing, positions }),
  };
}
