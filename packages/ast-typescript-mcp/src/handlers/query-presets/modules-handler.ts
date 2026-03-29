import type { QueryGraphPreset } from "../../types/index.js";
import { BaseQueryPresetHandler } from "./base-handler.js";

/**
 * Handler for the "modules" preset.
 * Returns file counts grouped by directory (module).
 */
export class ModulesHandler extends BaseQueryPresetHandler {
  readonly preset: QueryGraphPreset = "modules";

  getQuery(): string {
    return `.nodes | group_by(.filePath | split("/") | .[-2]) | map({module: .[0].filePath | split("/") | .[-2], files: length}) | sort_by(-.files)`;
  }
}
