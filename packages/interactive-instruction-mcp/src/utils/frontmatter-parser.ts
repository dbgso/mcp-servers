import type { DocumentFrontmatter } from "../types/index.js";

// Standard frontmatter at file start
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;

// Frontmatter keys for array fields
const WHEN_TO_USE_KEY = "whenToUse" as const;
const RELATED_DOCS_KEY = "relatedDocs" as const;
type ArrayFieldKey = typeof WHEN_TO_USE_KEY | typeof RELATED_DOCS_KEY;

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
  let currentKey: ArrayFieldKey | null = null;
  let currentArray: string[] = [];

  // Save current array to result based on key
  const saveCurrentArray = () => {
    if (currentKey && currentArray.length > 0) {
      if (currentKey === WHEN_TO_USE_KEY) {
        result.whenToUse = currentArray;
      } else if (currentKey === RELATED_DOCS_KEY) {
        result.relatedDocs = currentArray;
      }
    }
    currentKey = null;
    currentArray = [];
  };

  // Parse inline array value
  const parseInlineArray = (value: string): string[] => {
    return value
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };

  // Parse inline or multi-line array value
  const parseArrayField = (key: ArrayFieldKey, value: string) => {
    saveCurrentArray(); // Save previous array first
    currentKey = key;
    if (value) {
      // Inline array syntax: key: [a, b, c]
      if (value.startsWith("[") && value.endsWith("]")) {
        if (key === WHEN_TO_USE_KEY) {
          result.whenToUse = parseInlineArray(value);
        } else if (key === RELATED_DOCS_KEY) {
          result.relatedDocs = parseInlineArray(value);
        }
        currentKey = null;
        currentArray = [];
      } else {
        // Single inline value
        currentArray = [value];
      }
    } else {
      // Array will follow on next lines
      currentArray = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    // Check if this is an array item (starts with "- ")
    if (trimmed.startsWith("- ") && currentKey !== null) {
      currentArray.push(trimmed.slice(2).trim());
      continue;
    }

    // Check if this is a key-value pair
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();

      if (key === "description") {
        saveCurrentArray();
        result.description = value;
      } else if (key === WHEN_TO_USE_KEY) {
        parseArrayField(WHEN_TO_USE_KEY, value);
      } else if (key === RELATED_DOCS_KEY) {
        parseArrayField(RELATED_DOCS_KEY, value);
      } else {
        saveCurrentArray();
      }
    }
  }

  // Save final array if exists
  saveCurrentArray();

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

  if (frontmatter.whenToUse && frontmatter.whenToUse.length > 0) {
    lines.push(`${WHEN_TO_USE_KEY}:`);
    for (const item of frontmatter.whenToUse) {
      lines.push(`  - ${item}`);
    }
  }

  if (frontmatter.relatedDocs && frontmatter.relatedDocs.length > 0) {
    lines.push(`${RELATED_DOCS_KEY}:`);
    for (const item of frontmatter.relatedDocs) {
      lines.push(`  - ${item}`);
    }
  }

  return lines.join("\n") + "\n";
}
