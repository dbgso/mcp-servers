import type { BuildSpecParams, Layout } from "./types.js";

/**
 * Places nodes where the caller says.
 *
 * The positions are handed to the layout explicitly rather than left on the
 * element definitions, which cytoscape does not always read back.
 */
export class PresetLayout implements Layout {
  readonly name = "preset";
  readonly scriptUrls = [];
  readonly requiresPositions = true;

  buildSpec(params: BuildSpecParams): Record<string, unknown> {
    return { positions: Object.fromEntries(params.positions) };
  }
}
