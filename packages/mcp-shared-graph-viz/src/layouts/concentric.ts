import type { BuildSpecParams, Layout } from "./types.js";

export class ConcentricLayout implements Layout {
  readonly name = "concentric";
  readonly scriptUrls = [];
  readonly requiresPositions = false;

  buildSpec(params: BuildSpecParams): Record<string, unknown> {
    return { minNodeSpacing: 30 * params.spacing };
  }
}
