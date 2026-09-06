import { BaseLayout } from "./base.js";
import type { BuildSpecParams } from "./types.js";

/**
 * Places nodes where the caller says.
 *
 * The positions are handed to the layout explicitly rather than left on the
 * element definitions, which cytoscape does not always read back.
 */
export class PresetLayout extends BaseLayout {
  readonly name = "preset";
  override readonly requiresPositions = true;

  buildSpec(params: BuildSpecParams): Record<string, unknown> {
    return { positions: Object.fromEntries(params.positions) };
  }
}
