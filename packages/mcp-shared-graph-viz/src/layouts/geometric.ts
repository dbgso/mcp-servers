import type { Layout } from "./types.js";
import type { LayoutName } from "../types.js";

/**
 * Layouts that arrange nodes by shape alone and take no options beyond the
 * shared base.
 */
function geometricLayout(params: { name: LayoutName }): Layout {
  const { name } = params;
  return {
    name,
    scriptUrls: [],
    requiresPositions: false,
    buildSpec() {
      return {};
    },
  };
}

export const gridLayout = geometricLayout({ name: "grid" });
export const circleLayout = geometricLayout({ name: "circle" });
