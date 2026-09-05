import type { Layout } from "./types.js";

export const breadthfirstLayout: Layout = {
  name: "breadthfirst",
  scriptUrls: [],
  requiresPositions: false,
  buildSpec() {
    return { directed: true, grid: true };
  },
};
