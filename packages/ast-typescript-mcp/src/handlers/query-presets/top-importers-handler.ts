import type { QueryGraphPreset } from "../../types/index.js";
import { BaseQueryPresetHandler } from "./base-handler.js";

/**
 * Handler for the "top_importers" preset.
 * Returns the files that import the most other files.
 */
export class TopImportersHandler extends BaseQueryPresetHandler {
  readonly preset: QueryGraphPreset = "top_importers";

  getQuery(): string {
    return `.edges | group_by(.from) | map({file: .[0].from, count: length}) | sort_by(-.count) | .[0:20]`;
  }
}
