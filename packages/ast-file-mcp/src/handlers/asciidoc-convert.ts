import type { AsciidocBlock } from "../types/index.js";

/**
 * Asciidoctor's block objects, turned into plain data.
 *
 * Every accessor is probed with `typeof … === "function"` before it is called.
 * That is not defensiveness for its own sake: `getBlocks()` hands back objects
 * typed as `unknown`, the set of accessors differs by block context -- a list
 * item has `getMarker`, a section has `getLevel`, a paragraph has neither --
 * and the shape has changed across asciidoctor.js releases. A converter that
 * assumes an accessor throws on a document that merely uses a block type it
 * had not met, which for a read-only operation is the wrong failure.
 *
 * It lives here rather than inside the handler so those guards can be driven
 * directly with the shapes they exist for. Reaching them through a parse is not
 * possible: a real block always has every accessor its context calls for.
 */

type RawBlock = Record<string, unknown> & { getContext(): string };

/** The attributes worth carrying over; the rest are asciidoctor's bookkeeping. */
const ATTRIBUTE_KEYS = ["language", "source-language", "linenums", "role"];

/** A reader that calls `block[getter]()` when the block has that accessor, else gives `undefined`. */
function probe(getter: string): (block: RawBlock) => unknown {
  return (block) => {
    const accessor = block[getter];
    if (typeof accessor !== "function") {
      return undefined;
    }
    return (accessor as () => unknown).call(block);
  };
}

/** The string-valued attributes among ATTRIBUTE_KEYS, or `undefined` when there are none. */
export function pickAttributes(attrs: unknown): Record<string, string> | undefined {
  if (!attrs || typeof attrs !== "object") {
    return undefined;
  }
  const source = attrs as Record<string, unknown>;
  const picked = Object.fromEntries(
    ATTRIBUTE_KEYS.filter((key) => typeof source[key] === "string").map((key) => [key, source[key]]),
  ) as Record<string, string>;
  return Object.keys(picked).length > 0 ? picked : undefined;
}

/**
 * A list item's text. The raw `.text` property is preferred over `getText()`:
 * `.text` keeps the AsciiDoc syntax (`link:url[text]`), `getText()` returns
 * rendered HTML (`<a href="url">text</a>`).
 */
function readText(block: RawBlock): unknown {
  return typeof block.text === "string" && block.text ? block.text : probe("getText")(block);
}

const isTruthy = (value: unknown): boolean => Boolean(value);
const isDefined = (value: unknown): boolean => value !== undefined;
const isNumber = (value: unknown): boolean => typeof value === "number";

/**
 * One row per captured field: how to read it, and which values are kept.
 * Order is the key order of the output.
 */
const FIELDS: ReadonlyArray<
  readonly [keyof AsciidocBlock, (block: RawBlock) => unknown, (value: unknown) => boolean]
> = [
  ["level", probe("getLevel"), isNumber],
  ["title", probe("getTitle"), isTruthy],
  ["style", probe("getStyle"), isTruthy],
  ["attributes", (b) => pickAttributes(probe("getAttributes")(b)), isDefined],
  ["marker", probe("getMarker"), isTruthy],
  ["source", probe("getSource"), isTruthy],
  ["text", readText, isTruthy],
  ["lines", probe("getLines"), Array.isArray],
];

export function convertBlocks(params: {
  blocks: unknown[];
  visited?: WeakSet<object>;
}): AsciidocBlock[] {
  const { blocks, visited = new WeakSet<object>() } = params;
  return blocks.map((block: unknown) => {
    // Prevent circular reference
    if (typeof block === "object" && block !== null) {
      if (visited.has(block)) {
        return { context: "circular_ref" };
      }
      visited.add(block);
    }

    const b = block as RawBlock;
    const result: Record<string, unknown> = { context: b.getContext() };
    for (const [key, read, accept] of FIELDS) {
      const value = read(b);
      if (accept(value)) {
        result[key] = value;
      }
    }

    // Process nested blocks
    const nestedBlocks = probe("getBlocks")(b) as unknown[] | undefined;
    if (nestedBlocks && nestedBlocks.length > 0) {
      result.blocks = convertBlocks({ blocks: nestedBlocks, visited });
    }

    return result as unknown as AsciidocBlock;
  });
}
