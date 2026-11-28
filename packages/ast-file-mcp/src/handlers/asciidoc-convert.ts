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

    const b = block as {
      getContext(): string;
      getContent?(): string;
      getLines?(): string[];
      getBlocks?(): unknown[];
      getLevel?(): number;
      getTitle?(): string;
      getStyle?(): string;
      getAttributes?(): Record<string, unknown>;
      getMarker?(): string;
    };

    const result: AsciidocBlock = {
      context: b.getContext(),
    };

    // Capture level for sections and lists
    if (typeof b.getLevel === "function") {
      const level = b.getLevel();
      if (typeof level === "number") {
        result.level = level;
      }
    }

    // Capture title for sections
    if (typeof b.getTitle === "function") {
      const title = b.getTitle();
      if (title) {
        result.title = title;
      }
    }

    // Capture style for listings (e.g., "source")
    if (typeof b.getStyle === "function") {
      const style = b.getStyle();
      if (style) {
        result.style = style;
      }
    }

    // Capture relevant attributes
    if (typeof b.getAttributes === "function") {
      const attrs = b.getAttributes();
      if (attrs && typeof attrs === "object") {
        const relevantAttrs: Record<string, string> = {};
        const keysToCapture = ["language", "source-language", "linenums", "role"];
        for (const key of keysToCapture) {
          if (key in attrs && typeof attrs[key] === "string") {
            relevantAttrs[key] = attrs[key] as string;
          }
        }
        if (Object.keys(relevantAttrs).length > 0) {
          result.attributes = relevantAttrs;
        }
      }
    }

    // Capture marker for list items
    if (typeof b.getMarker === "function") {
      const marker = b.getMarker();
      if (marker) {
        result.marker = marker;
      }
    }

    // Capture source for paragraphs (getSource returns raw AsciiDoc)
    const bWithSource = b as { getSource?(): string };
    if (typeof bWithSource.getSource === "function") {
      const source = bWithSource.getSource();
      if (source) {
        result.source = source;
      }
    }

    // Capture text for list items
    // For list items, prefer raw .text property over getText() method
    // .text preserves raw AsciiDoc syntax (e.g., link:url[text])
    // .getText() returns rendered HTML (e.g., <a href="url">text</a>)
    const bWithTextProp = b as { text?: string };
    if (typeof bWithTextProp.text === "string" && bWithTextProp.text) {
      result.text = bWithTextProp.text;
    } else {
      const bWithText = b as { getText?(): string };
      if (typeof bWithText.getText === "function") {
        const text = bWithText.getText();
        if (text) {
          result.text = text;
        }
      }
    }

    // Capture lines
    if (typeof b.getLines === "function") {
      const lines = b.getLines();
      if (Array.isArray(lines)) {
        result.lines = lines;
      }
    }

    // Process nested blocks
    if (typeof b.getBlocks === "function") {
      const nestedBlocks = b.getBlocks();
      if (nestedBlocks && nestedBlocks.length > 0) {
        result.blocks = convertBlocks({ blocks: nestedBlocks, visited });
      }
    }

    return result;
  });
}
