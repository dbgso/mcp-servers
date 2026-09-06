import type { Layout } from "./types.js";

export class BreadthfirstLayout implements Layout {
  readonly name = "breadthfirst";
  readonly scriptUrls = [];
  readonly requiresPositions = false;

  buildSpec(): Record<string, unknown> {
    return { directed: true, grid: true };
  }
}
