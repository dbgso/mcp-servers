import type { Section } from "../types/index.js";

/** A heading's depth and text, as a section range needs them. */
export interface HeadingMark {
  depth: number;
  text: string;
}

/**
 * Where the section headed `headingText` starts and ends in `items`: from the
 * first heading with that text up to (not including) the next heading at the
 * same depth or shallower. Undefined when no heading has that text.
 *
 * Markdown's getSection (over tree nodes) and both handlers' getSectionText
 * (over source lines) each had their own copy of this scan.
 */
export function findSectionRange<T>(params: {
  items: T[];
  headingOf: (item: T) => HeadingMark | undefined;
  headingText: string;
}): { start: number; end: number } | undefined {
  const { items, headingOf, headingText } = params;
  const start = items.findIndex((item) => headingOf(item)?.text === headingText);
  if (start === -1) return undefined;

  const targetDepth = (headingOf(items[start]) as HeadingMark).depth;
  const after = items.slice(start + 1).findIndex((item) => {
    const heading = headingOf(item);
    return heading !== undefined && heading.depth <= targetDepth;
  });
  return { start, end: after === -1 ? items.length : start + 1 + after };
}

/**
 * Split a document's top-level items into a preamble and sections.
 *
 * An item that starts a section at the requested level opens one; everything
 * after it belongs to that section until the next one opens, and everything
 * before the first goes to the preamble. Both handlers group this way: the
 * AsciiDoc one used to send an item that was not a section at the requested
 * level to the preamble wherever it stood, and since the preamble is written
 * first, reordering moved such an item to the top of the document.
 */
export function groupSections<T>(params: {
  items: T[];
  /** The title when `item` opens a section at the requested level, else undefined. */
  sectionTitle: (item: T) => string | undefined;
  level: number;
}): { preamble: T[]; sections: Section<T>[] } {
  const { items, sectionTitle, level } = params;
  const preamble: T[] = [];
  const sections: Section<T>[] = [];

  for (const item of items) {
    const title = sectionTitle(item);
    if (title !== undefined) {
      sections.push({ title, level, content: [item] });
      continue;
    }
    const current = sections.at(-1);
    (current ? current.content : preamble).push(item);
  }

  return { preamble, sections };
}
