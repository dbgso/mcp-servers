import type { BuildSpecParams, Layout } from "./types.js";

/**
 * Places nodes where the caller says.
 *
 * The positions are handed to the layout explicitly rather than left on the
 * element definitions, which cytoscape does not always read back.
 */
export const presetLayout: Layout = {
  name: "preset",
  scriptUrls: [],
  requiresPositions: true,
  buildSpec({ positions }: BuildSpecParams) {
    return { positions: Object.fromEntries(positions) };
  },
};
