# Type Definitions

Core types for ast-file-mcp.

## AST Types

```typescript
// Markdown uses mdast
import type { Root as MdastRoot } from "mdast";

// AsciiDoc custom structure
interface AsciidocDocument {
  type: "asciidoc";
  title?: string;
  blocks: AsciidocBlock[];
}

interface AsciidocBlock {
  context: string;      // "section", "paragraph", "listing", etc.
  content?: string;
  lines?: string[];
  blocks?: AsciidocBlock[];
}
```

## Read Result

```typescript
interface AstReadResult {
  filePath: string;
  fileType: "markdown" | "asciidoc";
  ast: MdastRoot | AsciidocDocument;
}
```

## Query Types

```typescript
type QueryType = "full" | "headings" | "code_blocks" | "lists" | "links";

interface HeadingSummary {
  depth: number;    // 1-6
  text: string;
  line: number;     // 1-based
}

interface CodeBlockSummary {
  lang: string | null;
  value: string;
  line: number;
}

interface ListSummary {
  ordered: boolean;
  items: string[];
  line: number;
}

interface LinkSummary {
  url: string;
  title: string | null;
  text: string;
  line: number;
}

interface QueryResult {
  filePath: string;
  fileType: "markdown" | "asciidoc";
  query: QueryType;
  data: MdastRoot | AsciidocDocument | HeadingSummary[] | CodeBlockSummary[] | ListSummary[] | LinkSummary[];
}
```

## Overview Types (no line numbers)

```typescript
// Used by crawl/read_directory for compact output
interface HeadingOverview {
  depth: number;
  text: string;
}

interface LinkOverview {
  url: string;
  text: string;
}

interface FileSummary {
  filePath: string;
  fileType: "markdown" | "asciidoc";
  headings: HeadingOverview[];
  links: LinkOverview[];
}
```

## Crawl Result

```typescript
interface CrawlResult {
  startFile: string;
  files: FileSummary[];
  errors: Array<{ filePath: string; error: string }>;
}
```

## Link Check Types

```typescript
interface LinkCheckItem {
  url: string;
  text: string;
  line: number;
  reason?: string;   // Present for broken/skipped
}

interface LinkCheckResult {
  filePath: string;
  valid: LinkCheckItem[];
  broken: LinkCheckItem[];
  skipped: LinkCheckItem[];
}
```

## Diff Structure Types

```typescript
interface DiffStructureParams {
  filePathA: string;
  filePathB: string;
  level?: "summary" | "detailed";
}

interface DiffStructureResult {
  filePathA: string;
  filePathB: string;
  fileType: "markdown" | "asciidoc";
  added: DiffItem[];
  removed: DiffItem[];
  modified: DiffModifiedItem[];  // Only in detailed mode
  summary: string;
}

interface DiffItem {
  key: string;        // "{depth}:{text}"
  depth: number;
  text: string;
  line?: number;      // Only in detailed mode
}

interface DiffModifiedItem {
  key: string;
  a: { depth: number; text: string; line: number };
  b: { depth: number; text: string; line: number };
}
```
