import type { DocumentFrontmatter } from "../types/index.js";

// Standard frontmatter at file start
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Parse YAML frontmatter from markdown content
 * Frontmatter must be at the start of the file
 */
export function parseFrontmatter(content: string): DocumentFrontmatter {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return {};
  }

  const yamlContent = match[1];
  const result: DocumentFrontmatter = {};

  const lines = yamlContent.split("\n");
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    // Check if this is an array item (starts with "- ")
    if (trimmed.startsWith("- ") && currentKey && currentArray) {
      currentArray.push(trimmed.slice(2).trim());
      continue;
    }

    // Check if this is a key-value pair
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();

      // Save previous array if exists
      if (currentKey === "triggers" && currentArray) {
        result.triggers = currentArray;
      }

      if (key === "description") {
        result.description = value;
        currentKey = null;
        currentArray = null;
      } else if (key === "triggers") {
        currentKey = "triggers";
        if (value) {
          // Inline array syntax: triggers: [a, b, c]
          if (value.startsWith("[") && value.endsWith("]")) {
            result.triggers = value
              .slice(1, -1)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            currentKey = null;
            currentArray = null;
          } else {
            // Single inline value
            currentArray = value ? [value] : [];
          }
        } else {
          // Array will follow on next lines
          currentArray = [];
        }
      } else {
        currentKey = null;
        currentArray = null;
      }
    }
  }

  // Save final array if exists
  if (currentKey === "triggers" && currentArray) {
    result.triggers = currentArray;
  }

  return result;
}

/**
 * Remove frontmatter from content and return the body
 */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_REGEX, "").trim();
}

/**
 * Create or update frontmatter in content
 */
export function updateFrontmatter(params: {
  content: string;
  frontmatter: DocumentFrontmatter;
}): string {
  const { content, frontmatter } = params;
  const body = stripFrontmatter(content);
  const yaml = serializeFrontmatter(frontmatter);
  return `---\n${yaml}---\n\n${body}`;
}

/**
 * Serialize frontmatter object to YAML string
 */
function serializeFrontmatter(frontmatter: DocumentFrontmatter): string {
  const lines: string[] = [];

  if (frontmatter.description) {
    lines.push(`description: ${frontmatter.description}`);
  }

  if (frontmatter.triggers && frontmatter.triggers.length > 0) {
    lines.push("triggers:");
    for (const trigger of frontmatter.triggers) {
      lines.push(`  - ${trigger}`);
    }
  }

  return lines.join("\n") + "\n";
}
