import type { EdgeStyle, GraphInput, LayoutOptions, ThemeOptions } from "../types.js";

/**
 * What a renderer is asked to draw.
 *
 * This is the whole of it. A format's own settings are not arguments here —
 * they are given when the renderer is built, so every renderer can be called
 * through the same signature.
 */
export interface RenderParams {
  graph: GraphInput;
  layout?: LayoutOptions;
  theme?: ThemeOptions;
  /** Heading or caption for the graph. */
  title?: string;
  /** Show a legend of the groups. Defaults to true when groups exist. */
  legend?: boolean;
  /** How edges are drawn. Defaults to "bezier". */
  edgeStyle?: EdgeStyle;
  /**
   * The order colours are assigned from, so a group keeps its colour across
   * views of one corpus. Pass the same list every time; groups it omits fall
   * in behind, in the order this graph happens to contain them.
   */
  groupOrder?: readonly string[];
}

/**
 * One output format.
 *
 * `render` is declared as a property rather than a method so TypeScript checks
 * it contravariantly: a renderer that quietly demanded more than `RenderParams`
 * would be rejected instead of slipping through.
 *
 * `TOutput` is a type parameter because that is the part that genuinely
 * differs: a raster format returns bytes, and a renderer that has to fetch a
 * font or drive a browser returns a promise.
 */
export interface Renderer<TOutput = string> {
  /**
   * The format this renderer produces, as a plain name.
   *
   * Matching is left to whoever holds the renderers, so the normalisation —
   * case, surrounding space, aliases — is written once there rather than
   * repeated in every renderer, where each is free to get it slightly wrong.
   */
  readonly format: string;
  render: (params: RenderParams) => TOutput;
}
