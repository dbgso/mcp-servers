import { BaseLayout } from "./base.js";
import type { BuildSpecParams } from "./types.js";
import type { LayoutName } from "../types.js";

export const ELK_SCRIPT_URLS = [
  "https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js",
  "https://cdn.jsdelivr.net/npm/cytoscape-elk@2.3.0/dist/cytoscape-elk.js",
] as const;

/** ELK's own name for each algorithm this package exposes. */
export type ElkAlgorithm = "layered" | "mrtree" | "stress";

/**
 * ELK's `radial` is not offered.
 *
 * It requires a tree, and given a graph with a cycle it does not fail — it
 * spins, taking the page's main thread with it. A relation graph having a
 * mutual reference in it is ordinary, so the caller cannot be asked to know.
 */

/**
 * The Eclipse Layout Kernel, which is several layouts behind one extension.
 *
 * The algorithm is the only thing that varies, so it is what the constructor
 * takes — the scripts, the plugin and the option shape are shared.
 */
export class ElkLayout extends BaseLayout {
  /** The extension registers itself once, whichever algorithm we asked for. */
  override get cytoscapeName(): string {
    return "elk";
  }

  override readonly scriptUrls = ELK_SCRIPT_URLS;

  constructor(
    readonly name: LayoutName,
    private readonly algorithm: ElkAlgorithm,
  ) {
    super();
  }

  buildSpec(params: BuildSpecParams): Record<string, unknown> {
    const { options, spacing } = params;
    return {
      elk: {
        algorithm: this.algorithm,
        "elk.direction": ElkLayout.DIRECTIONS[options.direction ?? "TB"],
        "elk.spacing.nodeNode": 40 * spacing,
        "elk.layered.spacing.nodeNodeBetweenLayers": 70 * spacing,
      },
    };
  }

  /** ELK names its directions after the compass, not the ranks. */
  private static readonly DIRECTIONS: Record<string, string> = {
    TB: "DOWN",
    BT: "UP",
    LR: "RIGHT",
    RL: "LEFT",
  };
}
