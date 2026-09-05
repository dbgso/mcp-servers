import type { BuildSpecParams, Layout } from "./types.js";

export class CoseLayout implements Layout {
  readonly name = "cose";
  readonly scriptUrls = [];
  readonly requiresPositions = false;

  buildSpec(params: BuildSpecParams): Record<string, unknown> {
    const { spacing } = params;
    return {
      nodeRepulsion: 12000 * spacing,
      idealEdgeLength: 90 * spacing,
      numIter: 1000,
    };
  }
}
