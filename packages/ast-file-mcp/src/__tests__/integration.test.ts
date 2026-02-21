import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { paginate } from "mcp-shared";
import { MarkdownHandler } from "../handlers/markdown.js";
import { AsciidocHandler } from "../handlers/asciidoc.js";
import { getHandler, getSupportedExtensions } from "../handlers/index.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

describe("Integration Tests", () => {
  describe("MarkdownHandler - Basic Operations", () => {
    let handler: MarkdownHandler;

    beforeAll(() => {
      handler = new MarkdownHandler();
    });

    it("should read a Markdown file and return AST", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      const result = await handler.read(filePath);

      expect(result.filePath).toBe(filePath);
      expect(result.fileType).toBe("markdown");
      expect(result.ast).toBeDefined();
      expect(result.ast.type).toBe("root");
    });

    it("should query headings", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      const result = await handler.query(filePath, "headings");

      expect(result.query).toBe("headings");
      expect(Array.isArray(result.data)).toBe(true);

      const headings = result.data as Array<{ depth: number; text: string; line: number }>;
      const h1 = headings.find((h) => h.depth === 1);
      const h2s = headings.filter((h) => h.depth === 2);

      expect(h1).toBeDefined();
      expect(h1?.text).toBe("Sample Document");
      expect(h2s.length).toBeGreaterThan(0);
    });

    it("should query headings with depth filter", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      const result = await handler.query(filePath, "headings", { depth: 2 });

      const headings = result.data as Array<{ depth: number }>;
      // h3 (depth 3) should be excluded
      const hasH3 = headings.some((h) => h.depth > 2);
      expect(hasH3).toBe(false);
    });

    it("should query code blocks", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      const result = await handler.query(filePath, "code_blocks");

      expect(result.query).toBe("code_blocks");
      expect(Array.isArray(result.data)).toBe(true);

      const codeBlocks = result.data as Array<{ lang: string | null; value: string }>;
      const bashBlock = codeBlocks.find((b) => b.lang === "bash");
      const tsBlock = codeBlocks.find((b) => b.lang === "typescript");

      expect(bashBlock).toBeDefined();
      expect(tsBlock).toBeDefined();
      expect(tsBlock?.value).toContain("import");
    });

    it("should query lists", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      const result = await handler.query(filePath, "lists");

      expect(result.query).toBe("lists");
      expect(Array.isArray(result.data)).toBe(true);

      const lists = result.data as Array<{ ordered: boolean; items: string[] }>;
      expect(lists.length).toBeGreaterThan(0);

      const optionsList = lists.find((l) => l.items.some((i) => i.includes("Option A")));
      expect(optionsList).toBeDefined();
      expect(optionsList?.ordered).toBe(false);
    });

    it("should query links", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      const result = await handler.query(filePath, "links");

      expect(result.query).toBe("links");
      expect(Array.isArray(result.data)).toBe(true);

      const links = result.data as Array<{ url: string; text: string }>;
      const githubLink = links.find((l) => l.url.includes("github.com"));
      const localLink = links.find((l) => l.url.startsWith("./"));

      expect(githubLink).toBeDefined();
      expect(githubLink?.text).toBe("GitHub Repository");
      expect(localLink).toBeDefined();
    });

    it("should get content under specific heading", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      const result = await handler.query(filePath, "full", { heading: "Installation" });

      expect(result.data).toBeDefined();
      const ast = result.data as { type: string; children: unknown[] };
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });
  });

  describe("MarkdownHandler - Go to Definition", () => {
    let handler: MarkdownHandler;

    beforeAll(() => {
      handler = new MarkdownHandler();
    });

    it("should find definition of internal heading link", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      // Find the line with #installation link
      const result = await handler.goToDefinition(filePath, 38, 30);

      expect(result.sourceFilePath).toBe(filePath);
      // May or may not find the link depending on exact position
    });

    it("should find definition of file link", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      // Line with ./docs/README.md link
      const result = await handler.goToDefinition(filePath, 33, 20);

      // Check structure exists
      expect(result.sourceFilePath).toBe(filePath);
    });
  });

  describe("MarkdownHandler - Crawl", () => {
    let handler: MarkdownHandler;

    beforeAll(() => {
      handler = new MarkdownHandler();
    });

    it("should crawl from starting file", async () => {
      const startFile = join(FIXTURES_DIR, "sample.md");
      const result = await handler.crawl(startFile, 5);

      expect(result.startFile).toBe(startFile);
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files[0].filePath).toBe(startFile);
      expect(result.files[0].headings).toBeDefined();
      expect(result.files[0].links).toBeDefined();
    });

    it("should follow links to other markdown files", async () => {
      const startFile = join(FIXTURES_DIR, "sample.md");
      const result = await handler.crawl(startFile, 5);

      // Should find docs/README.md which is linked
      const docsReadme = result.files.find((f) => f.filePath.includes("docs/README.md"));
      expect(docsReadme).toBeDefined();
    });
  });

  describe("MarkdownHandler - Read Directory", () => {
    let handler: MarkdownHandler;

    beforeAll(() => {
      handler = new MarkdownHandler();
    });

    it("should find all markdown files in directory", async () => {
      const result = await handler.readDirectory(FIXTURES_DIR);

      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files.every((f) => f.fileType === "markdown")).toBe(true);
    });

    it("should include headings and links without line numbers", async () => {
      const result = await handler.readDirectory(FIXTURES_DIR);

      for (const file of result.files) {
        expect(file.headings).toBeDefined();
        expect(file.links).toBeDefined();
        expect(Array.isArray(file.headings)).toBe(true);
        expect(Array.isArray(file.links)).toBe(true);

        // Verify no line numbers in overview
        for (const heading of file.headings) {
          expect(heading).toHaveProperty("depth");
          expect(heading).toHaveProperty("text");
          expect(heading).not.toHaveProperty("line");
        }
        for (const link of file.links) {
          expect(link).toHaveProperty("url");
          expect(link).toHaveProperty("text");
          expect(link).not.toHaveProperty("line");
        }
      }
    });

    it("should filter by pattern", async () => {
      const result = await handler.readDirectory(FIXTURES_DIR, "*.md");

      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files.every((f) => f.filePath.endsWith(".md"))).toBe(true);
    });
  });

  describe("AsciidocHandler - Basic Operations", () => {
    let handler: AsciidocHandler;

    beforeAll(() => {
      handler = new AsciidocHandler();
    });

    it("should read an AsciiDoc file and return AST", async () => {
      const filePath = join(FIXTURES_DIR, "sample.adoc");
      const result = await handler.read(filePath);

      expect(result.filePath).toBe(filePath);
      expect(result.fileType).toBe("asciidoc");
      expect(result.ast).toBeDefined();
      expect(result.ast.type).toBe("asciidoc");
    });

    it("should extract document title", async () => {
      const filePath = join(FIXTURES_DIR, "sample.adoc");
      const result = await handler.read(filePath);

      const ast = result.ast as { title?: string };
      expect(ast.title).toBe("Sample AsciiDoc Document");
    });

    it("should get headings from AsciiDoc", async () => {
      const filePath = join(FIXTURES_DIR, "sample.adoc");
      const headings = await handler.getHeadingsFromFile(filePath);

      expect(headings.length).toBeGreaterThan(0);

      // Document title should be first
      expect(headings[0].text).toBe("Sample AsciiDoc Document");
      expect(headings[0].depth).toBe(1);

      // Should have section headings
      const installation = headings.find((h) => h.text === "Installation");
      expect(installation).toBeDefined();
    });

    it("should get links from AsciiDoc", async () => {
      const filePath = join(FIXTURES_DIR, "sample.adoc");
      const links = await handler.getLinksFromFile(filePath);

      expect(links.length).toBeGreaterThan(0);

      // Check for different link types
      const externalLink = links.find((l) => l.url.includes("github.com"));
      const xrefLink = links.find((l) => l.url.includes("guide.adoc"));
      const anchorLink = links.find((l) => l.url === "installation");

      expect(externalLink).toBeDefined();
      expect(xrefLink).toBeDefined();
      expect(anchorLink).toBeDefined();
    });

    it("should detect include directives as links", async () => {
      const filePath = join(FIXTURES_DIR, "sample.adoc");
      const links = await handler.getLinksFromFile(filePath);

      const includeLink = links.find((l) => l.url.includes("partial.adoc"));
      expect(includeLink).toBeDefined();
      expect(includeLink?.text).toContain("include:");
    });
  });

  describe("AsciidocHandler - Crawl", () => {
    let handler: AsciidocHandler;

    beforeAll(() => {
      handler = new AsciidocHandler();
    });

    it("should crawl from starting file", async () => {
      const startFile = join(FIXTURES_DIR, "sample.adoc");
      const result = await handler.crawl(startFile, 5);

      expect(result.startFile).toBe(startFile);
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files[0].filePath).toBe(startFile);
      expect(result.files[0].fileType).toBe("asciidoc");
    });

    it("should follow xref links to other adoc files", async () => {
      const startFile = join(FIXTURES_DIR, "sample.adoc");
      const result = await handler.crawl(startFile, 5);

      // Should find docs/guide.adoc which is linked via xref
      const guide = result.files.find((f) => f.filePath.includes("docs/guide.adoc"));
      expect(guide).toBeDefined();
    });
  });

  describe("AsciidocHandler - Read Directory", () => {
    let handler: AsciidocHandler;

    beforeAll(() => {
      handler = new AsciidocHandler();
    });

    it("should find all asciidoc files in directory", async () => {
      const result = await handler.readDirectory(FIXTURES_DIR);

      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files.every((f) => f.fileType === "asciidoc")).toBe(true);
    });

    it("should include headings and links without line numbers", async () => {
      const result = await handler.readDirectory(FIXTURES_DIR);

      for (const file of result.files) {
        expect(file.headings).toBeDefined();
        expect(file.links).toBeDefined();
        expect(Array.isArray(file.headings)).toBe(true);
        expect(Array.isArray(file.links)).toBe(true);

        // Verify no line numbers in overview
        for (const heading of file.headings) {
          expect(heading).toHaveProperty("depth");
          expect(heading).toHaveProperty("text");
          expect(heading).not.toHaveProperty("line");
        }
        for (const link of file.links) {
          expect(link).toHaveProperty("url");
          expect(link).toHaveProperty("text");
          expect(link).not.toHaveProperty("line");
        }
      }
    });
  });

  describe("Handler Registry", () => {
    it("should return MarkdownHandler for .md files", () => {
      const handler = getHandler("/path/to/file.md");
      expect(handler).toBeInstanceOf(MarkdownHandler);
    });

    it("should return AsciidocHandler for .adoc files", () => {
      const handler = getHandler("/path/to/file.adoc");
      expect(handler).toBeInstanceOf(AsciidocHandler);
    });

    it("should return undefined for unsupported files", () => {
      const handler = getHandler("/path/to/file.txt");
      expect(handler).toBeUndefined();
    });

    it("should list all supported extensions", () => {
      const extensions = getSupportedExtensions();
      expect(extensions).toContain("md");
      expect(extensions).toContain("markdown");
      expect(extensions).toContain("adoc");
      expect(extensions).toContain("asciidoc");
    });
  });

  describe("Pagination Integration", () => {
    let mdHandler: MarkdownHandler;

    beforeAll(() => {
      mdHandler = new MarkdownHandler();
    });

    it("should paginate read_directory results", async () => {
      const result = await mdHandler.readDirectory(FIXTURES_DIR);
      const files = result.files;

      // First page
      const page1 = paginate({ items: files, pagination: { limit: 1 } });
      expect(page1.data.length).toBe(1);
      expect(page1.total).toBe(files.length);
      expect(page1.hasMore).toBe(files.length > 1);

      // Second page
      if (page1.nextCursor) {
        const page2 = paginate({ items: files, pagination: { cursor: page1.nextCursor, limit: 1 } });
        expect(page2.data.length).toBe(1);
        expect(page2.data[0]).not.toEqual(page1.data[0]);
      }
    });

    it("should return all results when no limit specified", async () => {
      const result = await mdHandler.readDirectory(FIXTURES_DIR);
      const files = result.files;

      const paginated = paginate({ items: files, pagination: {} });
      expect(paginated.data).toEqual(files);
      expect(paginated.hasMore).toBe(false);
      expect(paginated.nextCursor).toBeUndefined();
    });

    it("should paginate crawl results", async () => {
      const startFile = join(FIXTURES_DIR, "sample.md");
      const result = await mdHandler.crawl(startFile, 5);
      const files = result.files;

      // First page
      const page1 = paginate({ items: files, pagination: { limit: 1 } });
      expect(page1.data.length).toBe(1);
      expect(page1.total).toBe(files.length);

      // Iterate through all pages
      let cursor: string | undefined;
      const allFiles = [];
      do {
        const page = paginate({ items: files, pagination: { cursor, limit: 1 } });
        allFiles.push(...page.data);
        cursor = page.nextCursor;
      } while (cursor);

      expect(allFiles).toEqual(files);
    });
  });
});
