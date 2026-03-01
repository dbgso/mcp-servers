import type { QueryGraphPreset } from "../../types/index.js";
import { BaseQueryPresetHandler } from "./base-handler.js";

/**
 * Handler for the "top_referenced" preset.
 * Returns the most referenced files sorted by reference count.
 */
export class TopReferencedHandler extends BaseQueryPresetHandler {
  readonly preset: QueryGraphPreset = "top_referenced";

  getQuery(): string {
    return `.edges | group_by(.to) | map({file: .[0].to, count: length}) | sort_by(-.count) | .[0:20]`;
  }
}
