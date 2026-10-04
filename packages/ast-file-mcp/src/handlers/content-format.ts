/**
 * The `format`s of `structured_write`, shared by every output language.
 *
 * Markdown and AsciiDoc each had the same four-arm switch over `format`, each
 * arm casting `data` and calling the handler's own generator. What differs
 * between the languages is the generator; what each format does with `data` is
 * the same, so it lives here once, one class per format.
 */

export interface SectionData {
  heading: string;
  depth?: number;
  content?: string;
}

/** What an output language provides: one generator per format. */
export interface ContentGenerator {
  generateTable(data: Record<string, unknown>[]): string;
  generateSection(options: SectionData): string;
  generateList(params: { items: string[]; options?: { ordered?: boolean } }): string;
  generateCode(params: { content: string; lang?: string }): string;
}

export type ContentFormatName = "table" | "section" | "list" | "code";

interface ContentFormat {
  generate(params: { generator: ContentGenerator; data: unknown }): string;
}

class TableFormat implements ContentFormat {
  generate(params: { generator: ContentGenerator; data: unknown }): string {
    const { generator, data } = params;
    return generator.generateTable(data as Record<string, unknown>[]);
  }
}

class SectionFormat implements ContentFormat {
  generate(params: { generator: ContentGenerator; data: unknown }): string {
    const { generator, data } = params;
    return generator.generateSection(data as SectionData);
  }
}

class ListFormat implements ContentFormat {
  generate(params: { generator: ContentGenerator; data: unknown }): string {
    const { generator, data } = params;
    const { items, ordered } = data as { items: string[]; ordered?: boolean };
    return generator.generateList({ items, options: { ordered } });
  }
}

class CodeFormat implements ContentFormat {
  generate(params: { generator: ContentGenerator; data: unknown }): string {
    const { generator, data } = params;
    const { content, lang } = data as { content: string; lang?: string };
    return generator.generateCode({ content, lang });
  }
}

const CONTENT_FORMATS: Record<ContentFormatName, ContentFormat> = {
  table: new TableFormat(),
  section: new SectionFormat(),
  list: new ListFormat(),
  code: new CodeFormat(),
};

function isContentFormatName(format: string): format is ContentFormatName {
  return Object.hasOwn(CONTENT_FORMATS, format);
}

/** Generate `data` as `format` in the generator's language. */
export function generateContent(params: {
  generator: ContentGenerator;
  format: string;
  data: unknown;
}): string {
  const { generator, format, data } = params;
  if (!isContentFormatName(format)) {
    throw new Error(`Unknown format: ${format}`);
  }
  return CONTENT_FORMATS[format].generate({ generator, data });
}
