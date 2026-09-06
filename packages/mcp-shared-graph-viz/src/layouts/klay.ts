import { BaseLayout } from "./base.js";
import type { BuildSpecParams } from "./types.js";

export const KLAY_SCRIPT_URLS = [
  "https://cdn.jsdelivr.net/npm/klayjs@0.4.1/klay.js",
  "https://cdn.jsdelivr.net/npm/cytoscape-klay@3.1.4/cytoscape-klay.js",
] as const;

/** Layered like dagre, usually with fewer edge crossings. */
export class KlayLayout extends BaseLayout {
  readonly name = "klay";
  override readonly scriptUrls = KLAY_SCRIPT_URLS;
  override readonly pluginGlobals = ["cytoscapeKlay"] as const;

  buildSpec(params: BuildSpecParams): Record<string, unknown> {
    const { options, spacing } = params;
    return {
      klay: {
        direction: KlayLayout.DIRECTIONS[options.direction ?? "TB"],
        spacing: 30 * spacing,
        edgeSpacingFactor: 0.5,
      },
    };
  }

  /** klay names its directions after the compass, not the ranks. */
  private static readonly DIRECTIONS: Record<string, string> = {
    TB: "DOWN",
    BT: "UP",
    LR: "RIGHT",
    RL: "LEFT",
  };
}
