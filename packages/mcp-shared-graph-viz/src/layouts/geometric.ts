import { BaseLayout } from "./base.js";
import type { LayoutName } from "../types.js";

/**
 * Layouts that arrange nodes by shape alone.
 *
 * Which shape is the only thing that varies, so it is what the constructor
 * takes; everything else is shared.
 */
export class GeometricLayout extends BaseLayout {
  constructor(readonly name: LayoutName) {
    super();
  }

  buildSpec(): Record<string, unknown> {
    return {};
  }
}
