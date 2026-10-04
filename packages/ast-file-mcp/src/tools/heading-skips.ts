import type { HeadingSummary } from "../types/index.js";

/** A heading more than one level deeper than the heading before it. */
export interface HeadingSkip {
  previous: HeadingSummary;
  current: HeadingSummary;
}

/**
 * Every place the heading hierarchy skips a level (h1 followed by h3, ...).
 * lint_document's heading-hierarchy rule and structure_analysis's
 * heading_skip warning each had their own copy of this loop.
 */
export function findHeadingSkips(headings: HeadingSummary[]): HeadingSkip[] {
  return headings.slice(1).flatMap((current, i) => {
    const previous = headings[i];
    return current.depth > previous.depth + 1 ? [{ previous, current }] : [];
  });
}
