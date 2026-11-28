import { BaseLayout } from "./base.js";
import type { BuildSpecParams } from "./types.js";

/** Rings, with the best-connected nodes in the middle. */
export class ConcentricLayout extends BaseLayout {
  readonly name = "concentric";

  buildSpec(params: BuildSpecParams): Record<string, unknown> {
    return { minNodeSpacing: 30 * params.spacing };
  }
}
