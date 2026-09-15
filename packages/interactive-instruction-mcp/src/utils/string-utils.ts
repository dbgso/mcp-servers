/**
 * Trims whitespace from a string and optionally collapses multiple spaces.
 */
export function trimString(params: {
  value: string;
  collapseSpaces?: boolean;
}): string {
  const { value, collapseSpaces = false } = params;

  let result = value.trim();

  if (collapseSpaces) {
    result = result.replace(/\s+/g, " ");
  }

  return result;
}

/**
 * Format a document summary as a markdown list item.
 * Includes description and optional "When to use" and "Related" sections.
 */
export function formatDocumentListItem(params: {
  id: string;
  description: string;
  whenToUse?: string[];
  relatedDocs?: string[];
}): string {
  const { id, description, whenToUse, relatedDocs } = params;
  let line = `- **${id}**: ${description}`;
  if (whenToUse && whenToUse.length > 0) {
    line += `\n  - When to use: ${whenToUse.join(", ")}`;
  }
  if (relatedDocs && relatedDocs.length > 0) {
    line += `\n  - Related: ${relatedDocs.join(", ")}`;
  }
  return line;
}

/**
 * `content` ending in exactly one newline.
 *
 * Reported as #51: eight documents written through the MCP all came out
 * without a trailing newline, while the 91 edited by hand in the same corpus
 * kept theirs -- so `git diff` showed the last line of the body as a -/+ pair
 * even for a change that only touched the frontmatter, and the files stopped
 * being POSIX text files (`wc -l` short by one, `cat` joining lines).
 *
 * The cause is upstream of any single handler: `stripFrontmatter` trims, and
 * the frontmatter writer ends at the body with no terminator. So this sits at
 * the reader's write sites rather than in each handler, which is how all three
 * routes in the report came to have it at once.
 */
export function withTrailingNewline(content: string): string {
  // An empty document stays empty: a file with a single newline in it is not
  // what "no content" should look like on disk.
  if (content === "") return content;
  return content.endsWith("\n") ? content : `${content}\n`;
}
