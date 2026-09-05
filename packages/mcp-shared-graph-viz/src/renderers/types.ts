import type { GraphInput, LayoutOptions, ThemeOptions } from "../types.js";

/**
 * What every renderer needs, whatever it emits.
 *
 * A format's own options extend this, so what is common to all renderers and
 * what belongs to one of them stay visibly apart.
 */
export interface RenderParams {
  graph: GraphInput;
  layout?: LayoutOptions;
  theme?: ThemeOptions;
  /** Heading or caption for the graph. */
  title?: string;
  /** Show a legend of the groups. Defaults to true when groups exist. */
  legend?: boolean;
}

/**
 * One output format.
 *
 * `TOutput` is a type parameter rather than `string` because that is the part
 * most likely to differ: a raster format returns bytes, and a renderer that
 * has to fetch a font or drive a browser returns a promise. Every renderer
 * takes exactly one params object, and that much does not change.
 */
export interface Renderer<TParams extends RenderParams = RenderParams, TOutput = string> {
  /** Identifies the format in messages and file extensions; not used to look it up. */
  readonly format: string;
  render(params: TParams): TOutput;
}
