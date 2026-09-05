import type { GraphInput, Palette, Swatch, ThemeOptions } from "./types.js";

/**
 * Light, print-friendly palette. Fill is pale so labels stay readable, stroke
 * is the saturated counterpart so shapes remain distinguishable in grayscale.
 */
export const DEFAULT_PALETTE: Palette = {
  swatches: [
    { fill: "#e8f0fe", stroke: "#3b6fd4", text: "#1b3a6b" },
    { fill: "#e9f7ef", stroke: "#2f9e5f", text: "#14512f" },
    { fill: "#fdf0e6", stroke: "#d3813a", text: "#6d3f14" },
    { fill: "#f3ecfb", stroke: "#8256c8", text: "#412a66" },
    { fill: "#fdeaef", stroke: "#cf4a70", text: "#6b2137" },
    { fill: "#e6f6f8", stroke: "#2e90a3", text: "#124751" },
    { fill: "#fbf5e0", stroke: "#b39222", text: "#5b4a0f" },
    { fill: "#eef0f3", stroke: "#66748a", text: "#2f3742" },
  ],
  background: "#ffffff",
  foreground: "#1f2430",
  mutedForeground: "#68707d",
  edge: "#8a94a3",
  neutral: { fill: "#f4f5f7", stroke: "#9aa3b0", text: "#2f3742" },
};

export const DEFAULT_FONT_FAMILY =
  "ui-sans-serif, -apple-system, 'Segoe UI', 'Helvetica Neue', 'Noto Sans JP', 'Hiragino Sans', Meiryo, sans-serif";

export const DEFAULT_FONT_SIZE = 13;

export interface ResolvedTheme {
  palette: Palette;
  fontFamily: string;
  fontSize: number;
  drawBackground: boolean;
}

export function resolveTheme(params: { theme?: ThemeOptions }): ResolvedTheme {
  const { theme } = params;
  return {
    palette: theme?.palette ?? DEFAULT_PALETTE,
    fontFamily: theme?.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontSize: theme?.fontSize ?? DEFAULT_FONT_SIZE,
    drawBackground: theme?.drawBackground ?? true,
  };
}

/**
 * Groups in first-appearance order.
 *
 * Order of appearance rather than hashing, so a graph with few groups always
 * gets clearly distinct colors and the same input always yields the same map.
 */
export function collectGroups(params: { graph: GraphInput }): string[] {
  const { graph } = params;
  const groups: string[] = [];
  for (const node of graph.nodes) {
    if (node.group !== undefined && !groups.includes(node.group)) {
      groups.push(node.group);
    }
  }
  return groups;
}

export function buildSwatchMap(params: {
  groups: string[];
  palette: Palette;
}): Map<string, Swatch> {
  const { groups, palette } = params;
  const map = new Map<string, Swatch>();
  for (const [index, group] of groups.entries()) {
    // Cycle through the palette when there are more groups than swatches.
    map.set(group, palette.swatches[index % palette.swatches.length]);
  }
  return map;
}

export function swatchFor(params: {
  group?: string;
  swatches: Map<string, Swatch>;
  palette: Palette;
}): Swatch {
  const { group, swatches, palette } = params;
  if (group === undefined) {
    return palette.neutral;
  }
  return swatches.get(group) ?? palette.neutral;
}
