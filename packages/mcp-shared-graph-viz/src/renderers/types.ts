import type { GraphInput, LayoutOptions, ThemeOptions } from "../types.js";

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
   * Whether this renderer produces the requested format.
   *
   * The renderer decides, rather than exposing a name for something else to
   * compare against: how a format is recognised — an alias, a file extension,
   * a media type — is the renderer's business, and a caller matching on a
   * `format` field would be reaching inside it.
   */
  isSupport: (format: string) => boolean;
  render: (params: RenderParams) => TOutput;
}
