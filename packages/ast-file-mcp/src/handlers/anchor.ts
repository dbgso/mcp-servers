/**
 * The anchor a heading is reached by, in one place.
 *
 * This was written four times: `toSlug` in each handler (a GitHub-style slug
 * that dropped every non-ASCII letter) and `generateAnchor` in topic_index and
 * find_backlinks (which kept CJK and produced asciidoctor's `_snake_case` ids).
 * topic_index handed out anchors that link_check and go_to_definition then
 * called broken, and every Japanese heading slugged to "" -- so it matched any
 * Japanese anchor at all.
 */

export type DocumentType = "markdown" | "asciidoc";

/** Word characters, whitespace, hiragana, katakana and CJK ideographs. */
const ANCHOR_CHARACTERS = "\\w\\s\\u3040-\\u309f\\u30a0-\\u30ff\\u4e00-\\u9faf";

/**
 * Lower case, characters outside the anchor set dropped, runs of whitespace
 * turned into one separator, separators trimmed from the ends, then a prefix.
 * The two document types differ only in the separator and the prefix.
 */
class Slugifier {
  private readonly dropped: RegExp;
  private readonly runs: RegExp;
  private readonly ends: RegExp;

  constructor(
    private readonly separator: string,
    private readonly prefix: string,
  ) {
    this.dropped = new RegExp(`[^${ANCHOR_CHARACTERS}${separator}]`, "g");
    this.runs = new RegExp(`${separator}+`, "g");
    this.ends = new RegExp(`^${separator}|${separator}$`, "g");
  }

  slug(text: string): string {
    const body = text
      .toLowerCase()
      .replace(this.dropped, "")
      .replace(/\s+/g, this.separator)
      .replace(this.runs, this.separator)
      .replace(this.ends, "");
    return this.prefix + body;
  }
}

const SLUGIFIERS: Record<DocumentType, Slugifier> = {
  // GitHub-flavoured Markdown: hyphens for spaces.
  markdown: new Slugifier("-", ""),
  // asciidoctor's generated section id: `_` prefix and separator.
  asciidoc: new Slugifier("_", "_"),
};

/** The anchor a heading gets in a document of the given type. */
export function headingAnchor(params: { text: string; fileType: DocumentType }): string {
  return SLUGIFIERS[params.fileType].slug(params.text);
}

/**
 * An anchor with case and separator style taken out, so `_section_one`,
 * `section-one` and `Section-One` compare equal. Links written by hand use
 * either style, whatever the document type.
 */
export function normalizeAnchor(anchor: string): string {
  return anchor.toLowerCase().replace(/^_/, "").replace(/_/g, "-");
}

/** Whether `anchor` is a way of writing the anchor of the heading `headingText`. */
export function anchorMatchesHeading(params: {
  anchor: string;
  headingText: string;
  fileType: DocumentType;
}): boolean {
  const { anchor, headingText, fileType } = params;
  return normalizeAnchor(headingAnchor({ text: headingText, fileType })) === normalizeAnchor(anchor);
}
