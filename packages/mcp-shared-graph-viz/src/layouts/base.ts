import type { BuildSpecParams, Layout } from "./types.js";
import type { LayoutName } from "../types.js";

/**
 * The parts of a layout that are the same for almost all of them.
 *
 * A layout built into cytoscape needs no scripts and no plugin registration;
 * only the ones provided by an extension override these.
 */
export abstract class BaseLayout implements Layout {
  readonly scriptUrls: readonly string[] = [];
  readonly pluginGlobals: readonly string[] = [];
  readonly requiresPositions: boolean = false;

  abstract readonly name: LayoutName;

  /** Defaults to our own name, which is what cytoscape knows for most of them. */
  get cytoscapeName(): string {
    return this.name;
  }

  abstract buildSpec(params: BuildSpecParams): Record<string, unknown>;
}
