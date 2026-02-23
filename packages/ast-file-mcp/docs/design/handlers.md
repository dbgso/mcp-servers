# Handler Design

File format handlers using polymorphism pattern.

## Class Hierarchy

```
BaseHandler (abstract)
├── MarkdownHandler
│   - remark/mdast parser
│   - write support
└── AsciidocHandler
    - asciidoctor.js parser
    - read only
```

## BaseHandler

```typescript
// src/handlers/base.ts
export abstract class BaseHandler implements FileHandler {
  abstract readonly extensions: string[];
  abstract readonly fileType: string;

  abstract read(filePath: string): Promise<AstReadResult>;
  write?(filePath: string, ast: unknown): Promise<void>;

  canHandle(filePath: string): boolean {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    return this.extensions.includes(ext);
  }
}
```

## MarkdownHandler

```typescript
// src/handlers/markdown.ts
export class MarkdownHandler extends BaseHandler {
  readonly extensions = ["md", "markdown"];
  readonly fileType = "markdown";

  // Core
  read(filePath: string): Promise<AstReadResult>;
  write(filePath: string, ast: MdastRoot): Promise<void>;

  // Query
  query(filePath: string, type: QueryType, options?): Promise<QueryResult>;

  // Navigation
  goToDefinition(filePath: string, line: number, column: number): Promise<GoToDefinitionResult>;

  // Discovery
  crawl(startFile: string, maxDepth: number): Promise<CrawlResult>;
  readDirectory(directory: string, pattern?: string): Promise<DirectoryResult>;

  // Analysis
  generateToc(filePath: string, depth?: number): Promise<string>;
  checkLinks(filePath: string, checkExternal?: boolean, timeout?: number): Promise<LinkCheckResult>;
  diffStructure(params: DiffStructureParams): Promise<DiffStructureResult>;
}
```

## AsciidocHandler

```typescript
// src/handlers/asciidoc.ts
export class AsciidocHandler extends BaseHandler {
  readonly extensions = ["adoc", "asciidoc", "asc"];
  readonly fileType = "asciidoc";

  // Core (read only)
  read(filePath: string): Promise<AstReadResult>;

  // Query (headings, links only)
  getHeadingsFromFile(filePath: string): Promise<HeadingSummary[]>;
  getLinksFromFile(filePath: string): Promise<LinkSummary[]>;

  // Discovery
  crawl(startFile: string, maxDepth: number): Promise<CrawlResult>;
  readDirectory(directory: string, pattern?: string): Promise<DirectoryResult>;

  // Analysis
  generateToc(filePath: string, depth?: number): Promise<string>;
  checkLinks(filePath: string, checkExternal?: boolean, timeout?: number): Promise<LinkCheckResult>;
  diffStructure(params: DiffStructureParams): Promise<DiffStructureResult>;
}
```

## Handler Registry

```typescript
// src/handlers/index.ts
const handlers = [new MarkdownHandler(), new AsciidocHandler()];

export function getHandler(filePath: string) {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return handlers.find((h) => h.extensions.includes(ext));
}

export function getSupportedExtensions(): string[] {
  return handlers.flatMap((h) => h.extensions);
}
```

## Dependencies

- `unified` / `remark-parse` / `remark-stringify` - Markdown parsing
- `mdast` - Markdown AST types
- `asciidoctor` - AsciiDoc parsing
- `mcp-shared` - Shared utilities (paginate, formatMultiFileResponse)
