import type { Layout } from "./types.js";
import type { LayoutName } from "../types.js";

/**
 * Layouts that arrange nodes by shape alone.
 *
 * Which shape is the only thing that varies, so it is what the constructor
 * takes; everything else is shared.
 */
export class GeometricLayout implements Layout {
  readonly scriptUrls = [];
  readonly requiresPositions = false;

  constructor(readonly name: LayoutName) {}

  buildSpec(): Record<string, unknown> {
    return {};
  }
}
