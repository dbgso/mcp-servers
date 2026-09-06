import type { GraphInput, Palette, Swatch, ThemeOptions } from "./types.js";

/**
 * Light palette. Fill is pale so labels stay readable, stroke is the saturated
 * counterpart so shapes remain distinguishable in grayscale.
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

/**
 * Unquoted on purpose. cytoscape validates `font-family` against
 * `^([\w- "]+(?:\s*,\s*[\w- "]+)*)$` and rejects single quotes outright,
 * silently falling back to its default font for everything it draws. CSS
 * accepts multi-word family names unquoted, so one stack serves both.
 */
export const DEFAULT_FONT_FAMILY =
  "ui-sans-serif, -apple-system, Segoe UI, Helvetica Neue, Noto Sans JP, Hiragino Sans, Meiryo, sans-serif";

export const DEFAULT_FONT_SIZE = 13;

export interface ResolvedTheme {
  palette: Palette;
  fontFamily: string;
  fontSize: number;
}

export function resolveTheme(params: { theme?: ThemeOptions }): ResolvedTheme {
  const { theme } = params;
  return {
    palette: theme?.palette ?? DEFAULT_PALETTE,
    fontFamily: theme?.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontSize: theme?.fontSize ?? DEFAULT_FONT_SIZE,
  };
}

/**
 * The groups present, in the order their colours are assigned from.
 *
 * Colour comes from a group's position in this list, which is why the caller
 * can supply it. Two views of one corpus contain different groups, so ordering
 * by what each view happens to contain moves a group's colour between them —
 * a document purple in the whole graph and orange in a close-up of it.
 *
 * Hashing the name instead would be stable across views but would collide:
 * three groups over eight swatches share a colour about a third of the time,
 * and two groups drawn the same colour is worse than one drawn differently
 * elsewhere. Position it stays, and a caller that knows the whole corpus can
 * pass `groupOrder` once and get both.
 *
 * Groups absent from `groupOrder` keep their colours after the ones in it, so
 * an incomplete list degrades rather than throws.
 */
export function collectGroups(params: { graph: GraphInput; groupOrder?: readonly string[] }): string[] {
  const { graph, groupOrder } = params;

  const present = new Set<string>();
  const appearance: string[] = [];
  for (const node of graph.nodes) {
    if (node.group !== undefined && !present.has(node.group)) {
      present.add(node.group);
      appearance.push(node.group);
    }
  }

  if (groupOrder === undefined) {
    return appearance;
  }

  // Every name the caller listed keeps its slot, whether or not this view has
  // it, so the colour of a group does not depend on which others turned up.
  const ordered = [...groupOrder];
  return [...ordered, ...appearance.filter((group) => !ordered.includes(group))];
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
