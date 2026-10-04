import type { AsciidocBlock } from "../types/index.js";

/**
 * AsciidocBlock back to AsciiDoc text: one serialiser per block context.
 *
 * This was a single switch of eleven arms in the handler, so no context could
 * be serialised -- or tested -- without the whole handler, and the arms that
 * differ only in their delimiter were written out three times. Contexts that
 * share a shape now share a class, configured by what differs.
 */

interface SerializeParams {
  block: AsciidocBlock;
  lines: string[];
  depth: number;
}

interface BlockSerializer {
  serialize(params: SerializeParams): void;
}

export function serializeBlocks(params: { blocks: AsciidocBlock[]; lines: string[]; depth: number }): void {
  const { blocks, lines, depth } = params;
  for (const block of blocks) {
    serializerFor(block.context).serialize({ block, lines, depth });
  }
}

function serializeChildren(params: SerializeParams): void {
  const { block, lines, depth } = params;
  if (block.blocks) {
    serializeBlocks({ blocks: block.blocks, lines, depth: depth + 1 });
  }
}

/** `lines` when the block was built by hand, `source` when it came from `read`. */
function verbatimBody(block: AsciidocBlock): string | undefined {
  if (block.lines) return block.lines.join("\n");
  return block.source || undefined;
}

/** A delimited block: its own lines, then its nested blocks, between delimiters. */
function writeDelimited(params: SerializeParams & { delimiter: string }): void {
  const { block, lines, delimiter } = params;
  lines.push(delimiter);
  if (block.lines) {
    lines.push(block.lines.join("\n"));
  }
  serializeChildren(params);
  lines.push(delimiter);
}

/** Holds the blocks before the first section; nothing of its own to write. */
class PreambleSerializer implements BlockSerializer {
  serialize(params: SerializeParams): void {
    const { block, lines, depth } = params;
    if (block.blocks) {
      serializeBlocks({ blocks: block.blocks, lines, depth });
    }
  }
}

/** `== Title` (level 1 = `==`, level 2 = `===`, ...), then the section's blocks. */
class SectionSerializer implements BlockSerializer {
  serialize(params: SerializeParams): void {
    const { block, lines } = params;
    if (block.title) {
      const prefix = "=".repeat((block.level ?? 1) + 1);
      lines.push(`${prefix} ${block.title}`, "");
    }
    serializeChildren(params);
  }
}

/** Prefers `source`, which keeps inline markup, over `lines` and `text`. */
class ParagraphSerializer implements BlockSerializer {
  serialize(params: SerializeParams): void {
    const { block, lines } = params;
    const text = paragraphText(block);
    if (text !== undefined) {
      lines.push(text, "");
    }
  }
}

function paragraphText(block: AsciidocBlock): string | undefined {
  if (block.source) return block.source;
  if (block.lines && block.lines.length > 0) return block.lines.join("\n");
  return block.text || undefined;
}

/** Listing (`----`) and literal (`....`) blocks: the body as it is. */
class VerbatimSerializer implements BlockSerializer {
  constructor(
    private readonly delimiter: string,
    private readonly writesSourceLanguage: boolean,
  ) {}

  serialize(params: SerializeParams): void {
    const { block, lines } = params;
    if (this.writesSourceLanguage && block.style === "source" && block.attributes?.language) {
      lines.push(`[source,${block.attributes.language}]`);
    }
    lines.push(this.delimiter);
    const body = verbatimBody(block);
    if (body !== undefined) {
      lines.push(body);
    }
    lines.push(this.delimiter, "");
  }
}

/**
 * Ordered and unordered lists differ only in the marker to fall back on. An
 * item's nested blocks are serialised after its own line: a sub-list under a
 * bullet is ordinary AsciiDoc, and writing it straight after its parent item
 * reproduces the nesting the parser found, since each item carries the marker
 * it was parsed with.
 */
class ListSerializer implements BlockSerializer {
  constructor(private readonly defaultMarker: string) {}

  serialize(params: SerializeParams): void {
    const { block, lines, depth } = params;
    if (!block.blocks) return;

    for (const item of block.blocks) {
      if (item.context !== "list_item") continue;
      // Prefer source (raw AsciiDoc) over text (rendered HTML)
      const text = item.source ?? item.text ?? item.lines?.join(" ") ?? "";
      lines.push(`${item.marker ?? this.defaultMarker} ${text}`);
      serializeChildren({ block: item, lines, depth });
    }
    lines.push("");
  }
}

/** Quote (`____`), sidebar (`****`) and example (`====`) blocks. */
class DelimitedSerializer implements BlockSerializer {
  constructor(
    private readonly delimiter: string,
    private readonly writesStyle: boolean,
  ) {}

  serialize(params: SerializeParams): void {
    const { block, lines } = params;
    if (this.writesStyle && block.style) {
      lines.push(`[${block.style}]`);
    }
    writeDelimited({ ...params, delimiter: this.delimiter });
    lines.push("");
  }
}

/**
 * `NOTE: text` for one line, otherwise `[NOTE]` over a `====` block. A
 * multi-line admonition is parsed with its prose in nested blocks rather than
 * in `lines`, so writing only `lines` left an empty `====` pair -- the body
 * gone, and nothing said about it.
 */
class AdmonitionSerializer implements BlockSerializer {
  serialize(params: SerializeParams): void {
    const { block, lines } = params;
    const type = block.style?.toUpperCase() ?? "NOTE";
    if (block.lines && block.lines.length === 1) {
      lines.push(`${type}: ${block.lines[0]}`);
    } else {
      lines.push(`[${type}]`);
      writeDelimited({ ...params, delimiter: "====" });
    }
    lines.push("");
  }
}

/** A context with no serialiser of its own: its lines, then its nested blocks. */
class FallbackSerializer implements BlockSerializer {
  serialize(params: SerializeParams): void {
    const { block, lines } = params;
    if (block.lines && block.lines.length > 0) {
      lines.push(block.lines.join("\n"), "");
    }
    serializeChildren(params);
  }
}

const SERIALIZERS: Record<string, BlockSerializer> = {
  preamble: new PreambleSerializer(),
  section: new SectionSerializer(),
  paragraph: new ParagraphSerializer(),
  listing: new VerbatimSerializer("----", true),
  literal: new VerbatimSerializer("....", false),
  ulist: new ListSerializer("*"),
  olist: new ListSerializer("."),
  quote: new DelimitedSerializer("____", true),
  sidebar: new DelimitedSerializer("****", false),
  example: new DelimitedSerializer("====", false),
  admonition: new AdmonitionSerializer(),
};

const FALLBACK = new FallbackSerializer();

function serializerFor(context: string): BlockSerializer {
  return Object.hasOwn(SERIALIZERS, context) ? SERIALIZERS[context] : FALLBACK;
}
