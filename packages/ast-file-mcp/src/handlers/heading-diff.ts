import type { DiffableItem } from "mcp-shared";
import type { HeadingSummary } from "../types/index.js";

/** What a detailed diff compares a heading on, beyond its key. */
function headingProperties(heading: HeadingSummary): Record<string, unknown> {
  return { depth: heading.depth, text: heading.text };
}

/**
 * A heading as `diffStructures` sees it. Depth and text together are the key,
 * so the same text at another depth counts as a different heading.
 *
 * Shared by the markdown and asciidoc handlers, which built it identically.
 */
export function headingToDiffable(params: {
  heading: HeadingSummary;
  detailed: boolean;
}): DiffableItem {
  const { heading, detailed } = params;
  return {
    key: `${heading.depth}:${heading.text}`,
    kind: `h${heading.depth}`,
    line: heading.line,
    properties: detailed ? headingProperties(heading) : undefined,
  };
}
