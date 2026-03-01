/**
 * Pattern Parser for comby-style patterns.
 *
 * Supports:
 * - :[name] - Named placeholder (matches balanced content)
 * - :[_] - Anonymous placeholder (not captured)
 */

export interface PatternToken {
  type: "literal" | "placeholder";
  value: string;
  name?: string; // For placeholder tokens
}

export interface ParsedPattern {
  tokens: PatternToken[];
  placeholderNames: string[];
}

const PLACEHOLDER_REGEX = /:\[([a-zA-Z_][a-zA-Z0-9_]*|_)\]/g;

/**
 * Parse a comby-style pattern into tokens.
 */
export function parsePattern(pattern: string): ParsedPattern {
  const tokens: PatternToken[] = [];
  const placeholderNames: string[] = [];
  let lastIndex = 0;

  for (const match of pattern.matchAll(PLACEHOLDER_REGEX)) {
    const matchIndex = match.index ?? 0;

    // Add literal before this placeholder
    if (matchIndex > lastIndex) {
      tokens.push({
        type: "literal",
        value: pattern.slice(lastIndex, matchIndex),
      });
    }

    // Add placeholder
    const name = match[1];
    tokens.push({
      type: "placeholder",
      value: match[0],
      name,
    });

    if (name !== "_" && !placeholderNames.includes(name)) {
      placeholderNames.push(name);
    }

    lastIndex = matchIndex + match[0].length;
  }

  // Add remaining literal
  if (lastIndex < pattern.length) {
    tokens.push({
      type: "literal",
      value: pattern.slice(lastIndex),
    });
  }

  return { tokens, placeholderNames };
}

/**
 * Convert a parsed pattern to a regex for matching.
 * Placeholders become capture groups.
 */
export function patternToRegex(parsed: ParsedPattern): RegExp {
  let regexStr = "";
  let groupIndex = 0;
  const groupMap: Map<string, number> = new Map();

  for (const token of parsed.tokens) {
    if (token.type === "literal") {
      // Escape regex special characters
      regexStr += escapeRegex(token.value);
    } else {
      // Placeholder - use non-greedy match
      // For balanced matching, we use a simple heuristic:
      // Match until we hit the next literal or end
      if (token.name === "_") {
        // Anonymous - non-capturing group
        regexStr += "(?:[\\s\\S]*?)";
      } else {
        // Named - capturing group
        regexStr += "([\\s\\S]*?)";
        if (token.name) {
          groupMap.set(token.name, groupIndex++);
        }
      }
    }
  }

  return new RegExp(regexStr, "g");
}

/**
 * Escape special regex characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply captured values to target pattern.
 */
export function applyCaptures(params: {
  target: string;
  captures: Map<string, string>;
}): string {
  const { target, captures } = params;
  let result = target;

  for (const [name, value] of captures) {
    const placeholder = `:[${name}]`;
    result = result.split(placeholder).join(value);
  }

  return result;
}
