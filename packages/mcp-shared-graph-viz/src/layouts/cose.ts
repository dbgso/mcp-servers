import type { BuildSpecParams, Layout } from "./types.js";

export const coseLayout: Layout = {
  name: "cose",
  scriptUrls: [],
  requiresPositions: false,
  buildSpec({ spacing }: BuildSpecParams) {
    return {
      nodeRepulsion: 12000 * spacing,
      idealEdgeLength: 90 * spacing,
      numIter: 1000,
    };
  },
};
