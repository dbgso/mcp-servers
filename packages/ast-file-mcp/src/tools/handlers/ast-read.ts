import { z } from "zod";
import type { FileResult } from "mcp-shared";
import { formatMultiFileResponse, getErrorMessage } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import {
  getHandler,
  getSupportedExtensions,
  type DocumentHandler,
} from "../../handlers/index.js";
import type { QueryType, QueryResult } from "../../types/index.js";

const ReadSchema = z.object({
  file_path: z
    .union([z.string(), z.array(z.string())])
    .describe(
      "Absolute path(s) to the file(s) to read. Can be a single path or array of paths."
    ),
  query: z
    .enum(["full", "headings", "code_blocks", "lists", "links", "sections"])
    .optional()
    .default("full")
    .describe(
      "Query type: full (entire AST), headings (heading list), code_blocks, lists, links, sections (lightweight section titles for reordering)"
    ),
  heading: z
    .string()
    .optional()
    .describe("Get plain text content under specific section heading (works with Markdown and AsciiDoc)"),
  depth: z.number().optional().describe("Max heading depth for headings query"),
  level: z.number().optional().describe("Section level for sections query (default: 1 for AsciiDoc ==, 2 for Markdown ##)"),
});

type ReadArgs = z.infer<typeof ReadSchema>;

interface SectionResult {
  filePath: string;
  fileType: "markdown" | "asciidoc";
  heading: string;
  content: string;
}

interface SectionSummary {
  title: string;
  level: number;
}

interface SectionsQueryResult {
  filePath: string;
  fileType: "markdown" | "asciidoc";
  query: "sections";
  sections: SectionSummary[];
}

type ReadResult = FileResult<QueryResult | SectionResult | SectionsQueryResult>;

interface ReadParams {
  handler: DocumentHandler;
  filePath: string;
  options: { heading?: string; depth?: number; level?: number };
}

/** What one way of reading a file returns for it. */
interface FileReader {
  read(params: ReadParams): Promise<ReadResult>;
}

/** `heading`: the plain text under that heading. */
class SectionTextReader implements FileReader {
  constructor(private readonly heading: string) {}

  async read(params: ReadParams): Promise<ReadResult> {
    const { handler, filePath } = params;
    const { heading } = this;
    const content = await handler.getSectionText({ filePath, headingText: heading });
    if (!content) {
      return { filePath, error: `Heading "${heading}" not found` };
    }
    return { filePath, result: { filePath, fileType: handler.fileType, heading, content } };
  }
}

/** `sections`: the titles at one level, for choosing an order to reorder into. */
class SectionsReader implements FileReader {
  async read(params: ReadParams): Promise<ReadResult> {
    const { handler, filePath, options } = params;
    const { sections } = await handler.getSections({ filePath, level: options.level ?? handler.defaultSectionLevel });
    return {
      filePath,
      result: {
        filePath,
        fileType: handler.fileType,
        query: "sections",
        sections: sections.map((s) => ({ title: s.title, level: s.level })),
      },
    };
  }
}

/** Every handler query type; each handler throws for the ones it does not support. */
class HandlerQueryReader implements FileReader {
  constructor(private readonly queryType: QueryType) {}

  async read(params: ReadParams): Promise<ReadResult> {
    const { handler, filePath, options } = params;
    return { filePath, result: await handler.query({ filePath, queryType: this.queryType, options }) };
  }
}

const READERS: Record<ReadArgs["query"], FileReader> = {
  full: new HandlerQueryReader("full"),
  headings: new HandlerQueryReader("headings"),
  code_blocks: new HandlerQueryReader("code_blocks"),
  lists: new HandlerQueryReader("lists"),
  links: new HandlerQueryReader("links"),
  sections: new SectionsReader(),
};

async function processFile(params: {
  filePath: string;
  query: ReadArgs["query"];
  options: { heading?: string; depth?: number; level?: number };
}): Promise<ReadResult> {
  const { filePath, query, options } = params;
  const handler = getHandler(filePath);

  if (!handler) {
    return { filePath, error: `Unsupported file type` };
  }

  // A heading asks for that section's text, whatever the query
  const reader = options.heading ? new SectionTextReader(options.heading) : READERS[query];
  try {
    return await reader.read({ handler, filePath, options });
  } catch (error) {
    return {
      filePath,
      error: getErrorMessage(error),
    };
  }
}

export class AstReadHandler extends BaseToolHandler<ReadArgs> {
  readonly name = "ast_read";
  readonly schema = ReadSchema;

  get description(): string {
    const extensions = getSupportedExtensions();
    return `Read file(s) and return AST or query specific elements. Supports multiple files. Supported extensions: ${extensions.join(", ")}. Query options: full (entire AST), headings, code_blocks, lists, links, sections (lightweight section titles for reordering). Use 'heading' parameter to get plain text content under a specific section heading.`;
  }

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        oneOf: [
          { type: "string", description: "Single file path" },
          {
            type: "array",
            items: { type: "string" },
            description: "Array of file paths",
          },
        ],
        description: "Absolute path(s) to the file(s) to read",
      },
      query: {
        type: "string",
        enum: ["full", "headings", "code_blocks", "lists", "links", "sections"],
        description: "Query type: full (entire AST), headings, code_blocks, lists, links, sections (lightweight section titles for reordering)",
      },
      heading: {
        type: "string",
        description: "Get plain text content under specific section heading (works with Markdown and AsciiDoc)",
      },
      depth: {
        type: "number",
        description: "Max heading depth for headings query",
      },
      level: {
        type: "number",
        description: "Section level for sections query (default: 1 for AsciiDoc ==, 2 for Markdown ##)",
      },
    },
    required: ["file_path"],
  };

  protected async doExecute(args: ReadArgs): Promise<ToolResponse> {
    const { file_path, query, heading, depth, level } = args;
    const filePaths = Array.isArray(file_path) ? file_path : [file_path];

    const results = await Promise.all(
      filePaths.map((fp) =>
        processFile({ filePath: fp, query, options: { heading, depth, level } })
      )
    );

    return formatMultiFileResponse(results);
  }
}
