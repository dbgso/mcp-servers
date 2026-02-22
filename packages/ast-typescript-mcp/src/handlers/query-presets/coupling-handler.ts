import type { QueryGraphPreset } from "../../types/index.js";
import { BaseQueryPresetHandler } from "./base-handler.js";

/**
 * Handler for the "coupling" preset.
 * Returns module coupling analysis showing dependencies between directories.
 */
export class CouplingHandler extends BaseQueryPresetHandler {
  readonly preset: QueryGraphPreset = "coupling";

  getQuery(): string {
    return `.edges | map({from: (.from | split("/") | .[-2]), to: (.to | split("/") | .[-2])}) | map(select(.from != .to)) | group_by([.from, .to]) | map({modules: [.[0].from, .[0].to], count: length}) | sort_by(-.count) | .[0:20]`;
  }
}
