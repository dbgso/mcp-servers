import type { BuildSpecParams, Layout } from "./types.js";

export const concentricLayout: Layout = {
  name: "concentric",
  scriptUrls: [],
  requiresPositions: false,
  buildSpec({ spacing }: BuildSpecParams) {
    return { minNodeSpacing: 30 * spacing };
  },
};
