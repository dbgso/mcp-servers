import type { MeasureLabel } from "./types.js";

/**
 * Label sizing without a canvas.
 *
 * Headless Node has no text metrics, so width is estimated per code point.
 * Callers with real font metrics can override via `measureLabel`.
 */

/** Characters noticeably narrower than the average latin glyph. */
const NARROW_CHARS = new Set([
  "i",
  "j",
  "l",
  "t",
  "f",
  "r",
  "I",
  "|",
  "!",
  ".",
  ",",
  ":",
  ";",
  "'",
  "`",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  " ",
]);

const WIDE_EM = 1.0;
const NARROW_EM = 0.32;
const REGULAR_EM = 0.58;

export const NODE_PADDING_X = 14;
export const NODE_PADDING_Y = 10;
export const MIN_NODE_WIDTH = 56;
export const MIN_NODE_HEIGHT = 32;
export const MAX_LABEL_WIDTH = 200;
export const MAX_LABEL_LINES = 3;
export const LINE_HEIGHT_RATIO = 1.35;

/** True for code points rendered at full width (CJK, kana, full-width forms). */
export function isWideChar(params: { char: string }): boolean {
  const { char } = params;
  const code = char.codePointAt(0);
  if (code === undefined) {
    return false;
  }
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

export function charWidthEm(params: { char: string }): number {
  const { char } = params;
  if (isWideChar({ char })) {
    return WIDE_EM;
  }
  if (NARROW_CHARS.has(char)) {
    return NARROW_EM;
  }
  return REGULAR_EM;
}

export const estimateTextWidth: MeasureLabel = (params) => {
  const { text, fontSize } = params;
  let em = 0;
  for (const char of text) {
    em += charWidthEm({ char });
  }
  return em * fontSize;
};

/**
 * Wrap a label to fit `maxWidth`.
 *
 * Latin text breaks on spaces; CJK has no word boundaries so it breaks per
 * character. A single token longer than the limit is broken mid-token rather
 * than allowed to overflow.
 */
export function wrapLabel(params: {
  text: string;
  maxWidth: number;
  fontSize: number;
  measure: MeasureLabel;
  maxLines?: number;
}): string[] {
  const { text, maxWidth, fontSize, measure, maxLines = MAX_LABEL_LINES } = params;
  if (text.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";

  for (const token of tokenize({ text })) {
    const candidate = current + token;
    if (measure({ text: candidate, fontSize }) <= maxWidth || current.length === 0) {
      current = candidate;
      continue;
    }
    lines.push(current.trimEnd());
    // A leading space would misalign the start of the wrapped line.
    current = token.trimStart();
  }
  lines.push(current.trimEnd());

  const kept = lines.filter((line, index) => index === 0 || line.length > 0);
  if (kept.length <= maxLines) {
    return kept;
  }
  // Content is being dropped, so the last visible line must say so even when
  // it would have fitted on its own.
  const truncated = kept.slice(0, maxLines);
  truncated[maxLines - 1] = elideToWidth({
    text: truncated[maxLines - 1],
    maxWidth,
    fontSize,
    measure,
  });
  return truncated;
}

/** Split into wrappable units: latin words keep trailing spaces, CJK is per character. */
export function tokenize(params: { text: string }): string[] {
  const { text } = params;
  const tokens: string[] = [];
  let buffer = "";

  const flush = (): void => {
    if (buffer.length > 0) {
      tokens.push(buffer);
      buffer = "";
    }
  };

  for (const char of text) {
    if (isWideChar({ char })) {
      flush();
      tokens.push(char);
      continue;
    }
    buffer += char;
    if (char === " " || char === "-" || char === "_" || char === "/") {
      flush();
    }
  }
  flush();
  return tokens;
}

/**
 * Shorten `text` so it fits, always ending with an ellipsis.
 *
 * The ellipsis is unconditional: it marks that something was cut, which a
 * silently shortened line would not.
 */
export function elideToWidth(params: {
  text: string;
  maxWidth: number;
  fontSize: number;
  measure: MeasureLabel;
}): string {
  const { text, maxWidth, fontSize, measure } = params;
  const ellipsis = "…";
  const chars = [...text];
  while (chars.length > 0) {
    const candidate = chars.join("") + ellipsis;
    if (measure({ text: candidate, fontSize }) <= maxWidth) {
      return candidate;
    }
    chars.pop();
  }
  return ellipsis;
}

export interface MeasuredLabel {
  lines: string[];
  width: number;
  height: number;
}

export function measureNode(params: {
  label: string;
  fontSize: number;
  measure: MeasureLabel;
  maxWidth?: number;
  explicitWidth?: number;
  explicitHeight?: number;
}): MeasuredLabel {
  const {
    label,
    fontSize,
    measure,
    maxWidth = MAX_LABEL_WIDTH,
    explicitWidth,
    explicitHeight,
  } = params;

  const lines = wrapLabel({ text: label, maxWidth, fontSize, measure });
  const widest = Math.max(...lines.map((line) => measure({ text: line, fontSize })));
  const width = explicitWidth ?? Math.max(MIN_NODE_WIDTH, Math.ceil(widest) + NODE_PADDING_X * 2);
  const textHeight = lines.length * fontSize * LINE_HEIGHT_RATIO;
  const height =
    explicitHeight ?? Math.max(MIN_NODE_HEIGHT, Math.ceil(textHeight) + NODE_PADDING_Y * 2);

  return { lines, width, height };
}
