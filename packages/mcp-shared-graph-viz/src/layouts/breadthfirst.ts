import { BaseLayout } from "./base.js";

/** Levels away from the roots. */
export class BreadthfirstLayout extends BaseLayout {
  readonly name = "breadthfirst";

  buildSpec(): Record<string, unknown> {
    return { directed: true, grid: true };
  }
}
