import { AvsdfLayout } from "./avsdf.js";
import { BreadthfirstLayout } from "./breadthfirst.js";
import { CiseLayout } from "./cise.js";
import { ColaLayout } from "./cola.js";
import { ConcentricLayout } from "./concentric.js";
import { CoseLayout } from "./cose.js";
import { DagreLayout } from "./dagre.js";
import { ElkLayout } from "./elk.js";
import { FcoseLayout } from "./fcose.js";
import { GeometricLayout } from "./geometric.js";
import { KlayLayout } from "./klay.js";
import { PresetLayout } from "./preset.js";
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
  dagre: new DagreLayout(),
  cose: new CoseLayout(),
  concentric: new ConcentricLayout(),
  grid: new GeometricLayout("grid"),
  circle: new GeometricLayout("circle"),
  breadthfirst: new BreadthfirstLayout(),
  preset: new PresetLayout(),
  fcose: new FcoseLayout(),
  cola: new ColaLayout(),
  klay: new KlayLayout(),
  cise: new CiseLayout(),
  avsdf: new AvsdfLayout(),
  "elk-layered": new ElkLayout("elk-layered", "layered"),
  "elk-mrtree": new ElkLayout("elk-mrtree", "mrtree"),
  "elk-stress": new ElkLayout("elk-stress", "stress"),
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
  clusters?: string[][];
}): LayoutSpec {
  const { layout = {}, positions = new Map<string, Point>(), clusters = [] } = params;
  const resolved = resolveLayout({ name: layout.name });
  const spacing = layout.spacing ?? 1;

  return {
    name: resolved.cytoscapeName,
    animate: false,
    fit: true,
    padding: FIT_PADDING,
    spacingFactor: spacing,
    ...resolved.buildSpec({ options: layout, spacing, positions, clusters }),
  };
}
