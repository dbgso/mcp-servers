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
 * Includes description and optional "When to use" section.
 */
export function formatDocumentListItem(params: {
  id: string;
  description: string;
  whenToUse?: string[];
}): string {
  const { id, description, whenToUse } = params;
  let line = `- **${id}**: ${description}`;
  if (whenToUse && whenToUse.length > 0) {
    line += `\n  - When to use: ${whenToUse.join(", ")}`;
  }
  return line;
}
