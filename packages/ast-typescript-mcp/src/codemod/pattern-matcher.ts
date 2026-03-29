/**
 * Pattern Matcher with balanced bracket support.
 *
 * Handles matching of patterns with :[name] placeholders,
 * respecting bracket balance (parentheses, braces, brackets).
 */

import {
  parsePattern,
  applyCaptures,
  type ParsedPattern,
} from "./pattern-parser.js";

export interface Match {
  start: number;
  end: number;
  fullMatch: string;
  captures: Map<string, string>;
}

export interface MatchResult {
  matches: Match[];
  source: string;
}

interface BracketState {
  parens: number;
  braces: number;
  brackets: number;
  angles: number;
}

/**
 * Check if brackets are balanced.
 */
function isBalanced(state: BracketState): boolean {
  return (
    state.parens === 0 &&
    state.braces === 0 &&
    state.brackets === 0 &&
    state.angles === 0
  );
}

/**
 * Update bracket state for a character.
 */
function updateBracketState({ state, char }: { state: BracketState; char: string }): void {
  switch (char) {
    case "(":
      state.parens++;
      break;
    case ")":
      state.parens--;
      break;
    case "{":
      state.braces++;
      break;
    case "}":
      state.braces--;
      break;
    case "[":
      state.brackets++;
      break;
    case "]":
      state.brackets--;
      break;
    case "<":
      state.angles++;
      break;
    case ">":
      state.angles--;
      break;
  }
}

/**
 * Find all matches of a pattern in source code.
 */
export function findMatches(params: {
  source: string;
  pattern: string;
}): MatchResult {
  const { source, pattern } = params;
  const parsed = parsePattern(pattern);
  const matches: Match[] = [];

  // Simple case: no placeholders
  if (parsed.placeholderNames.length === 0 && !pattern.includes(":[_]")) {
    let index = 0;
    while ((index = source.indexOf(pattern, index)) !== -1) {
      matches.push({
        start: index,
        end: index + pattern.length,
        fullMatch: pattern,
        captures: new Map(),
      });
      index++;
    }
    return { matches, source };
  }

  // Complex case: has placeholders
  const matchResults = matchWithPlaceholders({ source, parsed });
  return { matches: matchResults, source };
}

/**
 * Match pattern with placeholders using bracket-aware matching.
 */
function matchWithPlaceholders(params: {
  source: string;
  parsed: ParsedPattern;
}): Match[] {
  const { source, parsed } = params;
  const matches: Match[] = [];
  let searchStart = 0;

  while (searchStart < source.length) {
    const match = findNextMatch({ source, parsed, startIndex: searchStart });
    if (!match) break;

    matches.push(match);
    searchStart = match.end;
  }

  return matches;
}

/**
 * Find the next match starting from a given index.
 */
function findNextMatch(params: {
  source: string;
  parsed: ParsedPattern;
  startIndex: number;
}): Match | null {
  const { source, parsed, startIndex } = params;
  const tokens = parsed.tokens;

  if (tokens.length === 0) return null;

  // Find where the first literal token starts
  const firstToken = tokens[0];
  let searchPos = startIndex;

  while (searchPos < source.length) {
    let matchStart: number;
    let currentPos: number;

    if (firstToken.type === "literal") {
      // Find the first literal
      const literalStart = source.indexOf(firstToken.value, searchPos);
      if (literalStart === -1) return null;

      matchStart = literalStart;
      currentPos = literalStart + firstToken.value.length;
    } else {
      // Pattern starts with placeholder - start from searchPos
      matchStart = searchPos;
      currentPos = searchPos;
    }

    // Try to match the rest of the pattern
    const captures = new Map<string, string>();
    let tokenIndex = firstToken.type === "literal" ? 1 : 0;
    let success = true;

    while (tokenIndex < tokens.length && success) {
      const token = tokens[tokenIndex];

      if (token.type === "literal") {
        // Must find this literal
        const literalPos = findLiteralBalanced({
          source,
          literal: token.value,
          startPos: currentPos,
        });

        if (literalPos === -1) {
          success = false;
        } else {
          // Capture what's between currentPos and literalPos
          if (tokenIndex > 0) {
            const prevToken = tokens[tokenIndex - 1];
            if (prevToken.type === "placeholder" && prevToken.name && prevToken.name !== "_") {
              captures.set(prevToken.name, source.slice(currentPos, literalPos));
            }
          }
          currentPos = literalPos + token.value.length;
        }
      } else {
        // Placeholder - will be captured when we find the next literal
        // If this is the last token, capture to end (but be conservative)
        if (tokenIndex === tokens.length - 1) {
          // Last token is a placeholder - need to find reasonable end
          const endPos = findPlaceholderEnd({ source, startPos: currentPos });
          if (token.name && token.name !== "_") {
            captures.set(token.name, source.slice(currentPos, endPos));
          }
          currentPos = endPos;
        }
      }

      tokenIndex++;
    }

    if (success) {
      return {
        start: matchStart,
        end: currentPos,
        fullMatch: source.slice(matchStart, currentPos),
        captures,
      };
    }

    // Move past this potential match start
    searchPos = matchStart + 1;
  }

  return null;
}

/**
 * Find a literal string, ensuring bracket balance.
 */
function findLiteralBalanced(params: {
  source: string;
  literal: string;
  startPos: number;
}): number {
  const { source, literal, startPos } = params;
  const state: BracketState = { parens: 0, braces: 0, brackets: 0, angles: 0 };
  let pos = startPos;

  while (pos < source.length) {
    // Check if we can match the literal here
    if (isBalanced(state) && source.startsWith(literal, pos)) {
      return pos;
    }

    // Handle string literals
    const char = source[pos];
    if (char === '"' || char === "'" || char === "`") {
      pos = skipString({ source, startPos: pos, quote: char });
      continue;
    }

    updateBracketState({ state: state, char: char });
    pos++;
  }

  return -1;
}

/**
 * Find reasonable end for a trailing placeholder.
 */
function findPlaceholderEnd(params: {
  source: string;
  startPos: number;
}): number {
  const { source, startPos } = params;
  const state: BracketState = { parens: 0, braces: 0, brackets: 0, angles: 0 };
  let pos = startPos;

  while (pos < source.length) {
    const char = source[pos];

    // Handle string literals
    if (char === '"' || char === "'" || char === "`") {
      pos = skipString({ source, startPos: pos, quote: char });
      continue;
    }

    updateBracketState({ state: state, char: char });

    // Stop at statement boundaries when balanced
    if (isBalanced(state)) {
      if (char === ";" || char === "\n") {
        return pos;
      }
    }

    pos++;
  }

  return pos;
}

/**
 * Skip a string literal.
 */
function skipString(params: {
  source: string;
  startPos: number;
  quote: string;
}): number {
  const { source, startPos, quote } = params;
  let pos = startPos + 1;

  while (pos < source.length) {
    const char = source[pos];

    if (char === "\\") {
      pos += 2; // Skip escaped character
      continue;
    }

    if (char === quote) {
      return pos + 1;
    }

    // Handle template literal expressions
    if (quote === "`" && char === "$" && source[pos + 1] === "{") {
      pos = skipTemplateLiteralExpression({ source, startPos: pos + 2 });
      continue;
    }

    pos++;
  }

  return pos;
}

/**
 * Skip template literal expression ${...}.
 */
function skipTemplateLiteralExpression(params: {
  source: string;
  startPos: number;
}): number {
  const { source, startPos } = params;
  let depth = 1;
  let pos = startPos;

  while (pos < source.length && depth > 0) {
    const char = source[pos];

    if (char === "{") depth++;
    if (char === "}") depth--;

    pos++;
  }

  return pos;
}

/**
 * Apply a transformation: find all matches and replace with target pattern.
 */
export function transform(params: {
  source: string;
  sourcePattern: string;
  targetPattern: string;
}): { result: string; changes: Array<{ start: number; end: number; before: string; after: string }> } {
  const { source, sourcePattern, targetPattern } = params;
  const { matches } = findMatches({ source, pattern: sourcePattern });

  if (matches.length === 0) {
    return { result: source, changes: [] };
  }

  const changes: Array<{ start: number; end: number; before: string; after: string }> = [];
  let result = "";
  let lastEnd = 0;

  for (const match of matches) {
    // Add content before this match
    result += source.slice(lastEnd, match.start);

    // Apply the transformation
    const replacement = applyCaptures({
      target: targetPattern,
      captures: match.captures,
    });

    changes.push({
      start: match.start,
      end: match.end,
      before: match.fullMatch,
      after: replacement,
    });

    result += replacement;
    lastEnd = match.end;
  }

  // Add remaining content
  result += source.slice(lastEnd);

  return { result, changes };
}
