import type { QueryGraphPreset } from "../../types/index.js";
import { BaseQueryPresetHandler } from "./base-handler.js";

/**
 * Handler for the "orphans" preset.
 * Returns files that are not connected by any import edges.
 */
export class OrphansHandler extends BaseQueryPresetHandler {
  readonly preset: QueryGraphPreset = "orphans";

  getQuery(): string {
    return `(.nodes | map(.filePath)) as $all | (.edges | map(.from, .to) | unique) as $connected | $all - $connected`;
  }
}
