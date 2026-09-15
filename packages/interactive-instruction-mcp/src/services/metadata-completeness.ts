/**
 * Whether a document's metadata is there, decided in one place.
 *
 * `lint` and `list(missingMeta:)` both answer this question, and they
 * disagreed. A document with no `description` in its frontmatter does not come
 * back with an empty one: `MarkdownReader` substitutes the placeholder
 * `(No description)` so every listing has something to print. `lint` knew that
 * and checked for it; `list` checked for an empty string and so reported those
 * documents as complete.
 *
 * Measured on this repository's corpus at the time: `lint` found 56 documents
 * with no description, and `list(missingMeta: "description")` found none of
 * them -- while being the action whose help says it is how you find them.
 */

import type { MarkdownSummary } from "../types/index.js";

/** What the reader prints when a document supplies no description at all. */
export const MISSING_DESCRIPTION_PLACEHOLDER = "(No description)";

export function isDescriptionMissing(doc: Pick<MarkdownSummary, "description">): boolean {
  const { description } = doc;
  return (
    !description ||
    description === MISSING_DESCRIPTION_PLACEHOLDER ||
    description.trim() === ""
  );
}

export function isWhenToUseMissing(doc: Pick<MarkdownSummary, "whenToUse">): boolean {
  return doc.whenToUse === undefined || doc.whenToUse.length === 0;
}
