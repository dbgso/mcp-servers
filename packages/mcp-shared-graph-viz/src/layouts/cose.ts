import { BaseLayout } from "./base.js";
import type { BuildSpecParams } from "./types.js";

/** Force-directed, built in. Randomised, so it differs between runs. */
export class CoseLayout extends BaseLayout {
  readonly name = "cose";

  buildSpec(params: BuildSpecParams): Record<string, unknown> {
    const { spacing } = params;
    return {
      nodeRepulsion: 12000 * spacing,
      idealEdgeLength: 90 * spacing,
      numIter: 1000,
    };
  }
}
