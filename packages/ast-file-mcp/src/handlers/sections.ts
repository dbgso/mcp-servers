import type { Section } from "../types/index.js";

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
