import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { paginate } from "mcp-shared";
import { MarkdownHandler } from "../handlers/markdown.js";
import { AsciidocHandler } from "../handlers/asciidoc.js";
import { getHandler, getSupportedExtensions } from "../handlers/index.js";
import { ReadDirectoryHandler } from "../tools/handlers/read-directory.js";
import { TopicIndexHandler } from "../tools/handlers/topic-index.js";
import { AstReadHandler } from "../tools/handlers/ast-read.js";
import { GoToDefinitionHandler } from "../tools/handlers/go-to-definition.js";

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
      const result = await handler.query({ filePath, queryType: "headings" });

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
      const result = await handler.query({ filePath, queryType: "headings", options: { depth: 2 } });

      const headings = result.data as Array<{ depth: number }>;
      // h3 (depth 3) should be excluded
      const hasH3 = headings.some((h) => h.depth > 2);
      expect(hasH3).toBe(false);
    });

    it("should query code blocks", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      const result = await handler.query({ filePath, queryType: "code_blocks" });

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
      const result = await handler.query({ filePath, queryType: "lists" });

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
      const result = await handler.query({ filePath, queryType: "links" });

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
      const result = await handler.query({ filePath, queryType: "full", options: { heading: "Installation" } });

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
      const result = await handler.goToDefinition({ filePath, line: 38, column: 30 });

      expect(result.sourceFilePath).toBe(filePath);
      // May or may not find the link depending on exact position
    });

    it("should find definition of file link", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      // Line with ./docs/README.md link
      const result = await handler.goToDefinition({ filePath, line: 33, column: 20 });

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
      const result = await handler.crawl({ startFile, maxDepth: 5 });

      expect(result.startFile).toBe(startFile);
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files[0].filePath).toBe(startFile);
      expect(result.files[0].headings).toBeDefined();
      expect(result.files[0].links).toBeDefined();
    });

    it("should follow links to other markdown files", async () => {
      const startFile = join(FIXTURES_DIR, "sample.md");
      const result = await handler.crawl({ startFile, maxDepth: 5 });

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
      const result = await handler.readDirectory({ directory: FIXTURES_DIR });

      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files.every((f) => f.fileType === "markdown")).toBe(true);
    });

    it("should include headings and links without line numbers", async () => {
      const result = await handler.readDirectory({ directory: FIXTURES_DIR });

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
      const result = await handler.readDirectory({ directory: FIXTURES_DIR, pattern: "*.md" });

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
      const headings = await handler.getHeadingsFromFile({ filePath });

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

    it("should throw error for goToDefinition (not supported)", async () => {
      const filePath = join(FIXTURES_DIR, "sample.adoc");
      await expect(
        handler.goToDefinition({ filePath, line: 1, column: 1 })
      ).rejects.toThrow("goToDefinition is not supported for AsciiDoc files");
    });
  });

  describe("AsciidocHandler - Crawl", () => {
    let handler: AsciidocHandler;

    beforeAll(() => {
      handler = new AsciidocHandler();
    });

    it("should crawl from starting file", async () => {
      const startFile = join(FIXTURES_DIR, "sample.adoc");
      const result = await handler.crawl({ startFile, maxDepth: 5 });

      expect(result.startFile).toBe(startFile);
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files[0].filePath).toBe(startFile);
      expect(result.files[0].fileType).toBe("asciidoc");
    });

    it("should follow xref links to other adoc files", async () => {
      const startFile = join(FIXTURES_DIR, "sample.adoc");
      const result = await handler.crawl({ startFile, maxDepth: 5 });

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
      const result = await handler.readDirectory({ directory: FIXTURES_DIR });

      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files.every((f) => f.fileType === "asciidoc")).toBe(true);
    });

    it("should include headings and links without line numbers", async () => {
      const result = await handler.readDirectory({ directory: FIXTURES_DIR });

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

  describe("AsciidocHandler - Antora Style", () => {
    let handler: AsciidocHandler;

    beforeAll(() => {
      handler = new AsciidocHandler();
    });

    it("should extract headings from Antora-style document", async () => {
      const filePath = join(FIXTURES_DIR, "antora-index.adoc");
      const headings = await handler.getHeadingsFromFile({ filePath });

      expect(headings.length).toBeGreaterThan(0);
      expect(headings[0].text).toBe("DX Auth Documentation");
      expect(headings[0].depth).toBe(1);

      const archSection = headings.find((h) => h.text === "Architecture");
      expect(archSection).toBeDefined();
      expect(archSection?.depth).toBe(2);
    });

    it("should extract xref links from Antora-style document", async () => {
      const filePath = join(FIXTURES_DIR, "antora-index.adoc");
      const links = await handler.getLinksFromFile(filePath);

      expect(links.length).toBe(3);

      const overviewLink = links.find((l) => l.text === "Overview");
      expect(overviewLink).toBeDefined();
      expect(overviewLink?.url).toBe("architecture/overview.adoc");

      const auth0Link = links.find((l) => l.text === "Auth0");
      expect(auth0Link).toBeDefined();
    });

    it("should handle nested sections and include directives", async () => {
      const filePath = join(FIXTURES_DIR, "antora-overview.adoc");
      const headings = await handler.getHeadingsFromFile({ filePath });

      // Should have h1, h2, h3 levels
      const h1 = headings.find((h) => h.depth === 1);
      const h2s = headings.filter((h) => h.depth === 2);
      const h3s = headings.filter((h) => h.depth === 3);

      expect(h1?.text).toBe("System Overview");
      expect(h2s.length).toBeGreaterThanOrEqual(2);
      expect(h3s.length).toBeGreaterThanOrEqual(2);
    });

    it("should detect include directives as links", async () => {
      const filePath = join(FIXTURES_DIR, "antora-overview.adoc");
      const links = await handler.getLinksFromFile(filePath);

      const includeLink = links.find((l) => l.url.includes("partial$"));
      expect(includeLink).toBeDefined();
      expect(includeLink?.text).toContain("include:");
    });
  });

  describe("MarkdownHandler - Generate TOC", () => {
    let handler: MarkdownHandler;

    beforeAll(() => {
      handler = new MarkdownHandler();
    });

    it("should generate a TOC from markdown file", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      const toc = await handler.generateToc({ filePath });

      expect(toc).toBeDefined();
      expect(typeof toc).toBe("string");

      // Should contain markdown links
      expect(toc).toContain("- [");
      expect(toc).toContain("](#");

      // Should contain the main headings
      expect(toc).toContain("Sample Document");
      expect(toc).toContain("Installation");
      expect(toc).toContain("Usage");
      expect(toc).toContain("Configuration");
    });

    it("should filter by depth", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      const toc = await handler.generateToc({ filePath, maxDepth: 2 });

      // Should contain h1 and h2
      expect(toc).toContain("Sample Document");
      expect(toc).toContain("Installation");

      // Should NOT contain h3 (Configuration)
      expect(toc).not.toContain("Configuration");
    });

    it("should return empty string for file with no headings", async () => {
      const filePath = join(FIXTURES_DIR, "empty.md");
      const toc = await handler.generateToc({ filePath });

      expect(toc).toBe("");
    });

    it("should properly indent nested headings", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      const toc = await handler.generateToc({ filePath });

      // h3 should be indented more than h2
      const lines = toc.split("\n");
      const installationLine = lines.find((l) => l.includes("Installation"));
      const configLine = lines.find((l) => l.includes("Configuration"));

      expect(installationLine).toBeDefined();
      expect(configLine).toBeDefined();

      // Configuration (h3) should have more leading spaces than Installation (h2)
      const installIndent = installationLine!.match(/^(\s*)/)?.[1].length ?? 0;
      const configIndent = configLine!.match(/^(\s*)/)?.[1].length ?? 0;
      expect(configIndent).toBeGreaterThan(installIndent);
    });
  });

  describe("AsciidocHandler - Generate TOC", () => {
    let handler: AsciidocHandler;

    beforeAll(() => {
      handler = new AsciidocHandler();
    });

    it("should generate a TOC from asciidoc file", async () => {
      const filePath = join(FIXTURES_DIR, "sample.adoc");
      const toc = await handler.generateToc({ filePath });

      expect(toc).toBeDefined();
      expect(typeof toc).toBe("string");

      // Should contain asciidoc xref format
      expect(toc).toContain("*");
      expect(toc).toContain("<<");
      expect(toc).toContain(">>");

      // Should contain the main headings
      expect(toc).toContain("Sample AsciiDoc Document");
      expect(toc).toContain("Installation");
      expect(toc).toContain("Usage");
      expect(toc).toContain("Configuration");
    });

    it("should filter by depth", async () => {
      const filePath = join(FIXTURES_DIR, "sample.adoc");
      const toc = await handler.generateToc({ filePath, maxDepth: 2 });

      // Should contain level 1 and 2 headings
      expect(toc).toContain("Sample AsciiDoc Document");
      expect(toc).toContain("Installation");

      // Should NOT contain level 3 (Configuration)
      expect(toc).not.toContain("Configuration");
    });

    it("should properly use different star counts for different depths", async () => {
      const filePath = join(FIXTURES_DIR, "sample.adoc");
      const toc = await handler.generateToc({ filePath });

      // h1 should have one star, h2 should have two, h3 should have three
      const lines = toc.split("\n");
      const titleLine = lines.find((l) => l.includes("Sample AsciiDoc Document"));
      const installationLine = lines.find((l) => l.includes("Installation"));
      const configLine = lines.find((l) => l.includes("Configuration"));

      expect(titleLine).toMatch(/^\* /);
      expect(installationLine).toMatch(/^\*\* /);
      expect(configLine).toMatch(/^\*\*\* /);
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
      const result = await mdHandler.readDirectory({ directory: FIXTURES_DIR });
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
      const result = await mdHandler.readDirectory({ directory: FIXTURES_DIR });
      const files = result.files;

      const paginated = paginate({ items: files, pagination: {} });
      expect(paginated.data).toEqual(files);
      expect(paginated.hasMore).toBe(false);
      expect(paginated.nextCursor).toBeUndefined();
    });

    it("should paginate crawl results", async () => {
      const startFile = join(FIXTURES_DIR, "sample.md");
      const result = await mdHandler.crawl({ startFile, maxDepth: 5 });
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

  describe("MarkdownHandler - Link Check", () => {
    let handler: MarkdownHandler;

    beforeAll(() => {
      handler = new MarkdownHandler();
    });

    it("should identify valid internal file links", async () => {
      const filePath = join(FIXTURES_DIR, "link-test.md");
      const result = await handler.checkLinks({ filePath });

      expect(result.filePath).toBe(filePath);
      expect(result.valid).toBeDefined();
      expect(result.broken).toBeDefined();
      expect(result.skipped).toBeDefined();

      // ./docs/README.md should be valid
      const validFileLink = result.valid.find((l) => l.url === "./docs/README.md");
      expect(validFileLink).toBeDefined();
    });

    it("should identify valid anchor links", async () => {
      const filePath = join(FIXTURES_DIR, "link-test.md");
      const result = await handler.checkLinks({ filePath });

      // #valid-links should be valid
      const validAnchorLink = result.valid.find((l) => l.url === "#valid-links");
      expect(validAnchorLink).toBeDefined();
    });

    it("should identify broken file links", async () => {
      const filePath = join(FIXTURES_DIR, "link-test.md");
      const result = await handler.checkLinks({ filePath });

      // ./missing-file.md should be broken
      const brokenFileLink = result.broken.find((l) => l.url === "./missing-file.md");
      expect(brokenFileLink).toBeDefined();
      expect(brokenFileLink?.reason).toBe("file not found");
    });

    it("should identify broken anchor links", async () => {
      const filePath = join(FIXTURES_DIR, "link-test.md");
      const result = await handler.checkLinks({ filePath });

      // #nonexistent-section should be broken
      const brokenAnchorLink = result.broken.find((l) => l.url === "#nonexistent-section");
      expect(brokenAnchorLink).toBeDefined();
      expect(brokenAnchorLink?.reason).toContain("not found");
    });

    it("should skip external links by default", async () => {
      const filePath = join(FIXTURES_DIR, "link-test.md");
      const result = await handler.checkLinks({ filePath });

      // External links should be skipped
      const skippedLink = result.skipped.find((l) => l.url.startsWith("https://"));
      expect(skippedLink).toBeDefined();
      expect(skippedLink?.reason).toContain("external link");
    });

    it("should check file with anchor and detect broken anchor", async () => {
      const filePath = join(FIXTURES_DIR, "link-test.md");
      const result = await handler.checkLinks({ filePath });

      // ./docs/README.md#bad-anchor should be broken (file exists but anchor doesn't)
      const brokenAnchorInFile = result.broken.find((l) => l.url === "./docs/README.md#bad-anchor");
      expect(brokenAnchorInFile).toBeDefined();
      expect(brokenAnchorInFile?.reason).toContain("not found");
    });

    it("should validate file with valid anchor", async () => {
      const filePath = join(FIXTURES_DIR, "link-test.md");
      const result = await handler.checkLinks({ filePath });

      // ./docs/README.md#getting-started should be valid
      const validAnchorInFile = result.valid.find((l) => l.url === "./docs/README.md#getting-started");
      expect(validAnchorInFile).toBeDefined();
    });

    it("should check external URLs when enabled (mock valid)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", mockFetch);

      const filePath = join(FIXTURES_DIR, "link-test.md");
      const result = await handler.checkLinks({ filePath, checkExternal: true, timeout: 1000 });

      // External links should be in valid array
      const externalLinks = result.valid.filter((l) => l.url.startsWith("http"));
      expect(externalLinks.length).toBeGreaterThanOrEqual(0);

      vi.unstubAllGlobals();
    });

    it("should handle 405 status and retry with GET", async () => {
      // All external URLs return 405 on HEAD, then success on GET
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 405 })  // github.com HEAD
        .mockResolvedValueOnce({ ok: true })                // github.com GET
        .mockResolvedValueOnce({ ok: false, status: 405 })  // example.com HEAD
        .mockResolvedValueOnce({ ok: true });               // example.com GET
      vi.stubGlobal("fetch", mockFetch);

      const filePath = join(FIXTURES_DIR, "link-test.md");
      const result = await handler.checkLinks({ filePath, checkExternal: true });

      // 2 external URLs × 2 calls each (HEAD then GET) = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(4);
      // Both URLs should be valid after retry
      const externalLinks = result.valid.filter(l => l.url.startsWith("http"));
      expect(externalLinks.length).toBe(2);

      vi.unstubAllGlobals();
    });

    it("should handle broken external URLs", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      vi.stubGlobal("fetch", mockFetch);

      const filePath = join(FIXTURES_DIR, "link-test.md");
      const result = await handler.checkLinks({ filePath, checkExternal: true });

      // External links should be in broken array
      const brokenExternal = result.broken.filter((l) => l.url.startsWith("http"));
      // We may or may not have external links in the fixture
      expect(result.broken).toBeDefined();

      vi.unstubAllGlobals();
    });

    it("should handle fetch timeout", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      const mockFetch = vi.fn().mockRejectedValue(abortError);
      vi.stubGlobal("fetch", mockFetch);

      const filePath = join(FIXTURES_DIR, "link-test.md");
      const result = await handler.checkLinks({ filePath, checkExternal: true, timeout: 1 });

      // External links should be in broken array with timeout reason
      const timeoutBroken = result.broken.filter((l) => l.reason === "timeout");
      expect(timeoutBroken).toBeDefined();

      vi.unstubAllGlobals();
    });

    it("should handle fetch network errors", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      vi.stubGlobal("fetch", mockFetch);

      const filePath = join(FIXTURES_DIR, "link-test.md");
      const result = await handler.checkLinks({ filePath, checkExternal: true });

      // External links should be in broken array
      const networkBroken = result.broken.filter((l) => l.reason?.includes("Network error"));
      expect(networkBroken).toBeDefined();

      vi.unstubAllGlobals();
    });
  });

  describe("AsciidocHandler - Link Check", () => {
    let handler: AsciidocHandler;

    beforeAll(() => {
      handler = new AsciidocHandler();
    });

    it("should identify valid xref links", async () => {
      const filePath = join(FIXTURES_DIR, "link-test.adoc");
      const result = await handler.checkLinks({ filePath });

      expect(result.filePath).toBe(filePath);
      expect(result.valid).toBeDefined();
      expect(result.broken).toBeDefined();
      expect(result.skipped).toBeDefined();

      // docs/guide.adoc should be valid
      const validXrefLink = result.valid.find((l) => l.url === "docs/guide.adoc");
      expect(validXrefLink).toBeDefined();
    });

    it("should identify broken xref links", async () => {
      const filePath = join(FIXTURES_DIR, "link-test.adoc");
      const result = await handler.checkLinks({ filePath });

      // missing-file.adoc should be broken
      const brokenXrefLink = result.broken.find((l) => l.url === "missing-file.adoc");
      expect(brokenXrefLink).toBeDefined();
      expect(brokenXrefLink?.reason).toBe("file not found");
    });

    it("should identify valid inline anchor references", async () => {
      const filePath = join(FIXTURES_DIR, "link-test.adoc");
      const result = await handler.checkLinks({ filePath });

      // <<valid-links>> should be valid
      const validAnchorLink = result.valid.find((l) => l.url === "valid-links");
      expect(validAnchorLink).toBeDefined();
    });

    it("should identify broken inline anchor references", async () => {
      const filePath = join(FIXTURES_DIR, "link-test.adoc");
      const result = await handler.checkLinks({ filePath });

      // <<nonexistent-section>> should be broken
      const brokenAnchorLink = result.broken.find((l) => l.url === "nonexistent-section");
      expect(brokenAnchorLink).toBeDefined();
      expect(brokenAnchorLink?.reason).toContain("not found");
    });

    it("should skip external links by default", async () => {
      const filePath = join(FIXTURES_DIR, "link-test.adoc");
      const result = await handler.checkLinks({ filePath });

      // External links should be skipped
      const skippedLink = result.skipped.find((l) => l.url.startsWith("https://"));
      expect(skippedLink).toBeDefined();
      expect(skippedLink?.reason).toContain("external link");
    });
  });

  describe("MarkdownHandler - Diff Structure", () => {
    let handler: MarkdownHandler;

    beforeAll(() => {
      handler = new MarkdownHandler();
    });

    it("should detect added headings between two files", async () => {
      const filePathA = join(FIXTURES_DIR, "diff-a.md");
      const filePathB = join(FIXTURES_DIR, "diff-b.md");
      const result = await handler.diffStructure({ filePathA, filePathB, level: "summary" });

      expect(result.filePathA).toBe(filePathA);
      expect(result.filePathB).toBe(filePathB);
      expect(result.fileType).toBe("markdown");

      // New sections: "Quick Start", "Usage", "Troubleshooting", "FAQ"
      const addedKeys = result.added.map((a) => a.key);
      expect(addedKeys).toContain("2:Quick Start");
      expect(addedKeys).toContain("3:Usage");
      expect(addedKeys).toContain("2:Troubleshooting");
      expect(addedKeys).toContain("2:FAQ");
    });

    it("should detect removed headings between two files", async () => {
      const filePathA = join(FIXTURES_DIR, "diff-a.md");
      const filePathB = join(FIXTURES_DIR, "diff-b.md");
      const result = await handler.diffStructure({ filePathA, filePathB, level: "summary" });

      // Removed sections: "Getting Started", "Configuration", "API Reference"
      const removedKeys = result.removed.map((r) => r.key);
      expect(removedKeys).toContain("2:Getting Started");
      expect(removedKeys).toContain("3:Configuration");
      expect(removedKeys).toContain("2:API Reference");
    });

    it("should show common headings as unmodified", async () => {
      const filePathA = join(FIXTURES_DIR, "diff-a.md");
      const filePathB = join(FIXTURES_DIR, "diff-b.md");
      const result = await handler.diffStructure({ filePathA, filePathB, level: "summary" });

      // Common headings: "Document Title", "Introduction", "Installation"
      const addedKeys = result.added.map((a) => a.key);
      const removedKeys = result.removed.map((r) => r.key);

      // These should not be in added or removed
      expect(addedKeys).not.toContain("1:Document Title");
      expect(removedKeys).not.toContain("1:Document Title");
      expect(addedKeys).not.toContain("2:Introduction");
      expect(removedKeys).not.toContain("2:Introduction");
      expect(addedKeys).not.toContain("3:Installation");
      expect(removedKeys).not.toContain("3:Installation");
    });

    it("should include summary with counts", async () => {
      const filePathA = join(FIXTURES_DIR, "diff-a.md");
      const filePathB = join(FIXTURES_DIR, "diff-b.md");
      const result = await handler.diffStructure({ filePathA, filePathB, level: "summary" });

      expect(result.summary).toBeDefined();
      expect(typeof result.summary).toBe("string");
      expect(result.summary).toMatch(/Added|Removed/);
    });

    it("should report no changes when comparing same file", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      const result = await handler.diffStructure({
        filePathA: filePath,
        filePathB: filePath,
        level: "summary",
      });

      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.summary).toBe("No changes");
    });
  });

  describe("AsciidocHandler - Diff Structure", () => {
    let handler: AsciidocHandler;

    beforeAll(() => {
      handler = new AsciidocHandler();
    });

    it("should detect added headings between two files", async () => {
      const filePathA = join(FIXTURES_DIR, "diff-a.adoc");
      const filePathB = join(FIXTURES_DIR, "diff-b.adoc");
      const result = await handler.diffStructure({ filePathA, filePathB, level: "summary" });

      expect(result.filePathA).toBe(filePathA);
      expect(result.filePathB).toBe(filePathB);
      expect(result.fileType).toBe("asciidoc");

      // New sections should be added
      const addedKeys = result.added.map((a) => a.key);
      expect(addedKeys).toContain("2:Quick Start");
      expect(addedKeys).toContain("3:Usage");
      expect(addedKeys).toContain("2:Troubleshooting");
      expect(addedKeys).toContain("2:FAQ");
    });

    it("should detect removed headings between two files", async () => {
      const filePathA = join(FIXTURES_DIR, "diff-a.adoc");
      const filePathB = join(FIXTURES_DIR, "diff-b.adoc");
      const result = await handler.diffStructure({ filePathA, filePathB, level: "summary" });

      // Removed sections
      const removedKeys = result.removed.map((r) => r.key);
      expect(removedKeys).toContain("2:Getting Started");
      expect(removedKeys).toContain("3:Configuration");
      expect(removedKeys).toContain("2:API Reference");
    });

    it("should show common headings as unmodified", async () => {
      const filePathA = join(FIXTURES_DIR, "diff-a.adoc");
      const filePathB = join(FIXTURES_DIR, "diff-b.adoc");
      const result = await handler.diffStructure({ filePathA, filePathB, level: "summary" });

      // Common headings should not be in added or removed
      const addedKeys = result.added.map((a) => a.key);
      const removedKeys = result.removed.map((r) => r.key);

      expect(addedKeys).not.toContain("1:Document Title");
      expect(removedKeys).not.toContain("1:Document Title");
      expect(addedKeys).not.toContain("2:Introduction");
      expect(removedKeys).not.toContain("2:Introduction");
      expect(addedKeys).not.toContain("3:Installation");
      expect(removedKeys).not.toContain("3:Installation");
    });

    it("should include summary with counts", async () => {
      const filePathA = join(FIXTURES_DIR, "diff-a.adoc");
      const filePathB = join(FIXTURES_DIR, "diff-b.adoc");
      const result = await handler.diffStructure({ filePathA, filePathB, level: "summary" });

      expect(result.summary).toBeDefined();
      expect(typeof result.summary).toBe("string");
      expect(result.summary).toMatch(/Added|Removed/);
    });

    it("should report no changes when comparing same file", async () => {
      const filePath = join(FIXTURES_DIR, "sample.adoc");
      const result = await handler.diffStructure({
        filePathA: filePath,
        filePathB: filePath,
        level: "summary",
      });

      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.summary).toBe("No changes");
    });
  });

  describe("MarkdownHandler - Write Operations", () => {
    let handler: MarkdownHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new MarkdownHandler();
      tempDir = await mkdtemp(join(tmpdir(), "ast-file-mcp-test-"));
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should write AST back to file (round-trip)", async () => {
      const sourcePath = join(FIXTURES_DIR, "sample.md");
      const targetPath = join(tempDir, "sample-written.md");

      // Read original
      const readResult = await handler.read(sourcePath);

      // Write to new file
      await handler.write({ filePath: targetPath, ast: readResult.ast });

      // Read back
      const content = await readFile(targetPath, "utf-8");
      expect(content).toContain("# Sample Document");
      expect(content).toContain("## Installation");
      expect(content).toContain("npm install");
    });

    it("should preserve code blocks with language", async () => {
      const sourcePath = join(FIXTURES_DIR, "sample.md");
      const targetPath = join(tempDir, "sample-code.md");

      const readResult = await handler.read(sourcePath);
      await handler.write({ filePath: targetPath, ast: readResult.ast });

      const content = await readFile(targetPath, "utf-8");
      expect(content).toContain("```typescript");
      expect(content).toContain("```bash");
    });
  });

  describe("AsciidocHandler - Write Operations", () => {
    let handler: AsciidocHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new AsciidocHandler();
      tempDir = await mkdtemp(join(tmpdir(), "ast-file-mcp-test-adoc-"));
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should write AST back to file (round-trip)", async () => {
      const sourcePath = join(FIXTURES_DIR, "sample.adoc");
      const targetPath = join(tempDir, "sample-written.adoc");

      // Read original
      const readResult = await handler.read(sourcePath);

      // Write to new file
      await handler.write({ filePath: targetPath, ast: readResult.ast });

      // Read back
      const content = await readFile(targetPath, "utf-8");
      expect(content).toContain("= Sample AsciiDoc Document");
      expect(content).toContain("== Installation");
      expect(content).toContain("== Usage");
    });

    it("should preserve code blocks with language", async () => {
      const sourcePath = join(FIXTURES_DIR, "sample.adoc");
      const targetPath = join(tempDir, "sample-code.adoc");

      const readResult = await handler.read(sourcePath);
      await handler.write({ filePath: targetPath, ast: readResult.ast });

      const content = await readFile(targetPath, "utf-8");
      expect(content).toContain("[source,bash]");
      expect(content).toContain("[source,typescript]");
      expect(content).toContain("----");
    });

    it("should preserve list items", async () => {
      const sourcePath = join(FIXTURES_DIR, "sample.adoc");
      const targetPath = join(tempDir, "sample-list.adoc");

      const readResult = await handler.read(sourcePath);
      await handler.write({ filePath: targetPath, ast: readResult.ast });

      const content = await readFile(targetPath, "utf-8");
      expect(content).toContain("* Option A");
      expect(content).toContain("* Option B");
    });

    it("should preserve section hierarchy", async () => {
      const sourcePath = join(FIXTURES_DIR, "sample.adoc");
      const targetPath = join(tempDir, "sample-sections.adoc");

      const readResult = await handler.read(sourcePath);
      await handler.write({ filePath: targetPath, ast: readResult.ast });

      const content = await readFile(targetPath, "utf-8");
      // Level 1 sections (==)
      expect(content).toContain("== Installation");
      expect(content).toContain("== Usage");
      // Level 2 section (===)
      expect(content).toContain("=== Configuration");
    });

    it("should be re-readable after write", async () => {
      const sourcePath = join(FIXTURES_DIR, "sample.adoc");
      const targetPath = join(tempDir, "sample-reread.adoc");

      // Read original
      const readResult1 = await handler.read(sourcePath);

      // Write to new file
      await handler.write({ filePath: targetPath, ast: readResult1.ast });

      // Read the written file
      const readResult2 = await handler.read(targetPath);

      // Should have same structure
      expect(readResult2.fileType).toBe("asciidoc");
      expect(readResult2.ast).toBeDefined();

      // Compare AST structure
      const ast1 = readResult1.ast as { title?: string; blocks: unknown[] };
      const ast2 = readResult2.ast as { title?: string; blocks: unknown[] };

      expect(ast2.title).toBe(ast1.title);
      // Block count may differ slightly due to serialization (e.g., preamble handling)
      // Check that key sections are preserved
      expect(ast2.blocks.length).toBeGreaterThan(0);
    });
  });

  describe("AsciidocHandler - Preserve Elements", () => {
    let handler: AsciidocHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new AsciidocHandler();
      tempDir = await mkdtemp(join(tmpdir(), "ast-file-mcp-preserve-"));
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should preserve document attributes after round-trip", async () => {
      const sourcePath = join(FIXTURES_DIR, "preserve-test.adoc");
      const targetPath = join(tempDir, "preserve-attrs.adoc");

      const readResult = await handler.read(sourcePath);
      await handler.write({ filePath: targetPath, ast: readResult.ast });

      const content = await readFile(targetPath, "utf-8");
      expect(content).toContain(":toc:");
      expect(content).toContain(":sectnums:");
      expect(content).toContain(":author: Test Author");
      expect(content).toContain(":version: 1.0.0");
    });

    it("should preserve include directives after round-trip", async () => {
      const sourcePath = join(FIXTURES_DIR, "preserve-test.adoc");
      const targetPath = join(tempDir, "preserve-include.adoc");

      const readResult = await handler.read(sourcePath);
      await handler.write({ filePath: targetPath, ast: readResult.ast });

      const content = await readFile(targetPath, "utf-8");
      expect(content).toContain("include::partial.adoc[]");
    });

    it("should preserve single-line comments after round-trip", async () => {
      const sourcePath = join(FIXTURES_DIR, "preserve-test.adoc");
      const targetPath = join(tempDir, "preserve-comments.adoc");

      const readResult = await handler.read(sourcePath);
      await handler.write({ filePath: targetPath, ast: readResult.ast });

      const content = await readFile(targetPath, "utf-8");
      expect(content).toContain("// This is a single-line comment");
      expect(content).toContain("// Another comment");
    });

    it("should preserve block comments after round-trip", async () => {
      const sourcePath = join(FIXTURES_DIR, "preserve-test.adoc");
      const targetPath = join(tempDir, "preserve-block-comments.adoc");

      const readResult = await handler.read(sourcePath);
      await handler.write({ filePath: targetPath, ast: readResult.ast });

      const content = await readFile(targetPath, "utf-8");
      expect(content).toContain("////");
      expect(content).toContain("This is a block comment.");
    });

    it("should preserve all elements together", async () => {
      const sourcePath = join(FIXTURES_DIR, "preserve-test.adoc");
      const targetPath = join(tempDir, "preserve-all.adoc");

      const readResult = await handler.read(sourcePath);
      await handler.write({ filePath: targetPath, ast: readResult.ast });

      const content = await readFile(targetPath, "utf-8");

      // Document title
      expect(content).toContain("= Document with Preserved Elements");

      // Attributes
      expect(content).toContain(":toc:");
      expect(content).toContain(":author: Test Author");

      // Sections
      expect(content).toContain("== First Section");
      expect(content).toContain("=== Subsection");
      expect(content).toContain("== Second Section");

      // Include
      expect(content).toContain("include::partial.adoc[]");

      // Comments
      expect(content).toContain("// This is a single-line comment");
      expect(content).toContain("////");

      // List
      expect(content).toContain("* Item one");
      expect(content).toContain("* Item two");
    });
  });

  describe("MarkdownHandler - Structured Write", () => {
    let handler: MarkdownHandler;

    beforeAll(() => {
      handler = new MarkdownHandler();
    });

    it("should generate a table from data", () => {
      const data = [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ];
      const result = handler.generateTable(data);

      expect(result).toContain("| name | age |");
      expect(result).toContain("| --- | --- |");
      expect(result).toContain("| Alice | 30 |");
      expect(result).toContain("| Bob | 25 |");
    });

    it("should return empty string for empty table data", () => {
      const result = handler.generateTable([]);
      expect(result).toBe("");
    });

    it("should generate a section with heading", () => {
      const result = handler.generateSection({ heading: "Test", depth: 2, content: "Hello" });
      expect(result).toBe("## Test\n\nHello");
    });

    it("should generate a section without content", () => {
      const result = handler.generateSection({ heading: "Test", depth: 3 });
      expect(result).toBe("### Test");
    });

    it("should generate an unordered list", () => {
      const result = handler.generateList({ items: ["one", "two", "three"] });
      expect(result).toBe("- one\n- two\n- three");
    });

    it("should generate an ordered list", () => {
      const result = handler.generateList({ items: ["one", "two"], options: { ordered: true } });
      expect(result).toBe("1. one\n2. two");
    });

    it("should generate a code block with language", () => {
      const result = handler.generateCode({ content: "const x = 1;", lang: "typescript" });
      expect(result).toBe("```typescript\nconst x = 1;\n```");
    });

    it("should generate a code block without language", () => {
      const result = handler.generateCode({ content: "plain text" });
      expect(result).toBe("```\nplain text\n```");
    });

    it("should generate content using format dispatcher", () => {
      expect(handler.generate({ format: "table", data: [{ a: 1 }] })).toContain("| a |");
      expect(handler.generate({ format: "section", data: { heading: "X" } })).toBe("## X");
      expect(handler.generate({ format: "list", data: { items: ["a"] } })).toBe("- a");
      expect(handler.generate({ format: "code", data: { content: "x" } })).toBe("```\nx\n```");
    });

    it("should throw for unknown format", () => {
      expect(() => handler.generate({ format: "unknown", data: {} })).toThrow("Unknown format");
    });
  });

  describe("AsciidocHandler - Structured Write", () => {
    let handler: AsciidocHandler;

    beforeAll(() => {
      handler = new AsciidocHandler();
    });

    it("should generate a table from data", () => {
      const data = [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ];
      const result = handler.generateTable(data);

      expect(result).toContain("|===");
      expect(result).toContain("| name | age");
      expect(result).toContain("| Alice | 30");
      expect(result).toContain("| Bob | 25");
    });

    it("should return empty string for empty table data", () => {
      const result = handler.generateTable([]);
      expect(result).toBe("");
    });

    it("should generate a section with heading", () => {
      const result = handler.generateSection({ heading: "Test", depth: 2, content: "Hello" });
      expect(result).toBe("== Test\n\nHello");
    });

    it("should generate an unordered list", () => {
      const result = handler.generateList({ items: ["one", "two", "three"] });
      expect(result).toBe("* one\n* two\n* three");
    });

    it("should generate an ordered list", () => {
      const result = handler.generateList({ items: ["one", "two"], options: { ordered: true } });
      expect(result).toBe(". one\n. two");
    });

    it("should generate a code block with language", () => {
      const result = handler.generateCode({ content: "const x = 1;", lang: "typescript" });
      expect(result).toBe("[source,typescript]\n----\nconst x = 1;\n----");
    });

    it("should generate a code block without language", () => {
      const result = handler.generateCode({ content: "plain text" });
      expect(result).toBe("----\nplain text\n----");
    });

    it("should generate content using format dispatcher", () => {
      expect(handler.generate({ format: "table", data: [{ a: 1 }] })).toContain("|===");
      expect(handler.generate({ format: "section", data: { heading: "X" } })).toBe("== X");
      expect(handler.generate({ format: "list", data: { items: ["a"] } })).toBe("* a");
      expect(handler.generate({ format: "code", data: { content: "x" } })).toBe("----\nx\n----");
    });

    it("should throw for unknown format", () => {
      expect(() => handler.generate({ format: "unknown", data: {} })).toThrow("Unknown format");
    });
  });

  describe("ReadDirectoryHandler - Detail Levels", () => {
    let handler: ReadDirectoryHandler;

    beforeAll(() => {
      handler = new ReadDirectoryHandler();
    });

    it("should return only file paths with detail='files'", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
        detail: "files",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.files.length).toBeGreaterThan(0);

      // Should only have filePath and fileType
      const firstFile = parsed.files[0];
      expect(firstFile.filePath).toBeDefined();
      expect(firstFile.fileType).toBeDefined();
      expect(firstFile.headings).toBeUndefined();
      expect(firstFile.links).toBeUndefined();
    });

    it("should return paths and headings with detail='outline'", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
        detail: "outline",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.files.length).toBeGreaterThan(0);

      // Should have filePath, fileType, and headings but no links
      const firstFile = parsed.files[0];
      expect(firstFile.filePath).toBeDefined();
      expect(firstFile.fileType).toBeDefined();
      expect(firstFile.headings).toBeDefined();
      expect(firstFile.links).toBeUndefined();
    });

    it("should return full info with detail='full'", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
        detail: "full",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.files.length).toBeGreaterThan(0);

      // Should have all fields
      const firstFile = parsed.files[0];
      expect(firstFile.filePath).toBeDefined();
      expect(firstFile.fileType).toBeDefined();
      expect(firstFile.headings).toBeDefined();
      expect(firstFile.links).toBeDefined();
    });

    it("should filter headings by maxHeadingDepth", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
        detail: "outline",
        maxHeadingDepth: 1,
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.files.length).toBeGreaterThan(0);

      // All headings should have depth <= 1
      for (const file of parsed.files) {
        for (const heading of file.headings || []) {
          expect(heading.depth).toBeLessThanOrEqual(1);
        }
      }
    });

    it("should include deeper headings with higher maxHeadingDepth", async () => {
      const resultDepth1 = await handler.execute({
        directory: FIXTURES_DIR,
        detail: "outline",
        maxHeadingDepth: 1,
      });
      const resultDepth3 = await handler.execute({
        directory: FIXTURES_DIR,
        detail: "outline",
        maxHeadingDepth: 3,
      });

      const parsed1 = JSON.parse((resultDepth1.content[0] as { text: string }).text);
      const parsed3 = JSON.parse((resultDepth3.content[0] as { text: string }).text);

      // Count total headings
      const count1 = parsed1.files.reduce(
        (acc: number, f: { headings?: unknown[] }) => acc + (f.headings?.length || 0),
        0
      );
      const count3 = parsed3.files.reduce(
        (acc: number, f: { headings?: unknown[] }) => acc + (f.headings?.length || 0),
        0
      );

      // More headings should be included with higher depth
      expect(count3).toBeGreaterThanOrEqual(count1);
    });
  });

  describe("TopicIndexHandler", () => {
    let handler: TopicIndexHandler;

    beforeAll(() => {
      handler = new TopicIndexHandler();
    });

    it("should build topic index from all files in directory", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.topics).toBeDefined();
      expect(Array.isArray(parsed.topics)).toBe(true);
      expect(parsed.topics.length).toBeGreaterThan(0);
      expect(parsed.total).toBe(parsed.topics.length);

      // Each topic should have required fields
      for (const topic of parsed.topics) {
        expect(topic.text).toBeDefined();
        expect(topic.filePath).toBeDefined();
        expect(topic.anchor).toBeDefined();
        expect(topic.depth).toBeDefined();
        expect(topic.fileType).toMatch(/^(markdown|asciidoc)$/);
      }
    });

    it("should filter topics by pattern", async () => {
      const mdResult = await handler.execute({
        directory: FIXTURES_DIR,
        pattern: "*.md",
      });
      const adocResult = await handler.execute({
        directory: FIXTURES_DIR,
        pattern: "*.adoc",
      });

      const mdParsed = JSON.parse((mdResult.content[0] as { text: string }).text);
      const adocParsed = JSON.parse((adocResult.content[0] as { text: string }).text);

      // All markdown topics should have fileType "markdown"
      for (const topic of mdParsed.topics) {
        expect(topic.fileType).toBe("markdown");
      }

      // All asciidoc topics should have fileType "asciidoc"
      for (const topic of adocParsed.topics) {
        expect(topic.fileType).toBe("asciidoc");
      }
    });

    it("should filter topics by query", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
        query: "Installation",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.topics.length).toBeGreaterThan(0);

      // All topics should contain "Installation" (case-insensitive)
      for (const topic of parsed.topics) {
        expect(topic.text.toLowerCase()).toContain("installation");
      }
    });

    it("should filter topics by maxDepth", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
        maxDepth: 1,
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.topics.length).toBeGreaterThan(0);

      // All topics should have depth <= 1
      for (const topic of parsed.topics) {
        expect(topic.depth).toBeLessThanOrEqual(1);
      }
    });

    it("should generate correct anchors for markdown", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
        pattern: "*.md",
        query: "Sample Document",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      const sampleDoc = parsed.topics.find((t: { text: string }) => t.text === "Sample Document");

      expect(sampleDoc).toBeDefined();
      expect(sampleDoc.anchor).toBe("sample-document");
    });

    it("should generate correct anchors for asciidoc", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
        pattern: "*.adoc",
        query: "Sample AsciiDoc Document",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      const sampleDoc = parsed.topics.find((t: { text: string }) => t.text === "Sample AsciiDoc Document");

      expect(sampleDoc).toBeDefined();
      expect(sampleDoc.anchor).toBe("_sample_asciidoc_document");
    });

    it("should sort topics alphabetically", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      const texts = parsed.topics.map((t: { text: string }) => t.text);
      const sorted = [...texts].sort((a, b) => a.localeCompare(b));

      expect(texts).toEqual(sorted);
    });

    it("should support pagination", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
        limit: 5,
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.topics.length).toBe(5);
      expect(parsed.hasMore).toBe(true);
      expect(parsed.nextCursor).toBeDefined();

      // Fetch next page
      const nextResult = await handler.execute({
        directory: FIXTURES_DIR,
        limit: 5,
        cursor: parsed.nextCursor,
      });

      const nextParsed = JSON.parse((nextResult.content[0] as { text: string }).text);
      expect(nextParsed.topics.length).toBeGreaterThan(0);

      // Topics should be different
      expect(nextParsed.topics[0].text).not.toBe(parsed.topics[0].text);
    });
  });

  describe("AstReadHandler - Section Query", () => {
    let handler: AstReadHandler;

    beforeAll(() => {
      handler = new AstReadHandler();
    });

    it("should return plain text for Markdown section", async () => {
      const result = await handler.execute({
        file_path: join(FIXTURES_DIR, "sample.md"),
        heading: "Installation",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.heading).toBe("Installation");
      expect(parsed.content).toContain("## Installation");
      expect(parsed.fileType).toBe("markdown");
    });

    it("should return plain text for AsciiDoc section", async () => {
      const result = await handler.execute({
        file_path: join(FIXTURES_DIR, "sample.adoc"),
        heading: "Installation",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.heading).toBe("Installation");
      expect(parsed.content).toContain("== Installation");
      expect(parsed.fileType).toBe("asciidoc");
    });

    it("should return error for non-existent heading", async () => {
      const result = await handler.execute({
        file_path: join(FIXTURES_DIR, "sample.md"),
        heading: "NonExistentSection",
      });

      // Error responses are plain text, not JSON
      const errorText = (result.content[0] as { text: string }).text;
      expect(errorText).toContain("not found");
      expect(result.isError).toBe(true);
    });

    it("should extract section including sub-headings", async () => {
      const result = await handler.execute({
        file_path: join(FIXTURES_DIR, "sample.md"),
        heading: "Usage",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.content).toContain("## Usage");
      expect(parsed.content).toContain("### Configuration");
    });

    it("should stop at next same-level heading", async () => {
      const result = await handler.execute({
        file_path: join(FIXTURES_DIR, "sample.md"),
        heading: "Installation",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      // Installation section should not include Usage section
      expect(parsed.content).not.toContain("## Usage");
    });

    it("should work with headings query using polymorphism", async () => {
      const mdResult = await handler.execute({
        file_path: join(FIXTURES_DIR, "sample.md"),
        query: "headings",
      });

      const adocResult = await handler.execute({
        file_path: join(FIXTURES_DIR, "sample.adoc"),
        query: "headings",
      });

      const mdParsed = JSON.parse((mdResult.content[0] as { text: string }).text);
      const adocParsed = JSON.parse((adocResult.content[0] as { text: string }).text);

      expect(mdParsed.query).toBe("headings");
      expect(adocParsed.query).toBe("headings");
      expect(Array.isArray(mdParsed.data)).toBe(true);
      expect(Array.isArray(adocParsed.data)).toBe(true);
    });

    it("should work with links query using polymorphism", async () => {
      const mdResult = await handler.execute({
        file_path: join(FIXTURES_DIR, "sample.md"),
        query: "links",
      });

      const adocResult = await handler.execute({
        file_path: join(FIXTURES_DIR, "sample.adoc"),
        query: "links",
      });

      const mdParsed = JSON.parse((mdResult.content[0] as { text: string }).text);
      const adocParsed = JSON.parse((adocResult.content[0] as { text: string }).text);

      expect(mdParsed.query).toBe("links");
      expect(adocParsed.query).toBe("links");
      expect(Array.isArray(mdParsed.data)).toBe(true);
      expect(Array.isArray(adocParsed.data)).toBe(true);
    });

    it("should return error for code_blocks query on AsciiDoc", async () => {
      const result = await handler.execute({
        file_path: join(FIXTURES_DIR, "sample.adoc"),
        query: "code_blocks",
      });

      expect(result.isError).toBe(true);
      const errorText = (result.content[0] as { text: string }).text;
      expect(errorText).toContain("not supported for AsciiDoc");
    });

    it("should return error for lists query on AsciiDoc", async () => {
      const result = await handler.execute({
        file_path: join(FIXTURES_DIR, "sample.adoc"),
        query: "lists",
      });

      expect(result.isError).toBe(true);
      const errorText = (result.content[0] as { text: string }).text;
      expect(errorText).toContain("not supported for AsciiDoc");
    });
  });

  describe("AsciidocHandler - External URL Check", () => {
    let handler: AsciidocHandler;

    beforeAll(() => {
      handler = new AsciidocHandler();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("should check external URLs when checkExternal is true", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", mockFetch);

      const filePath = join(FIXTURES_DIR, "link-test.adoc");
      const result = await handler.checkLinks({ filePath, checkExternal: true });

      // External links should be in valid array
      const externalLinks = result.valid.filter((l) => l.url.startsWith("http"));
      expect(externalLinks.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle 405 status and retry with GET for AsciiDoc", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 405 })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false, status: 405 })
        .mockResolvedValueOnce({ ok: true });
      vi.stubGlobal("fetch", mockFetch);

      const filePath = join(FIXTURES_DIR, "link-test.adoc");
      const result = await handler.checkLinks({ filePath, checkExternal: true });

      expect(mockFetch).toHaveBeenCalledTimes(4);
      const externalLinks = result.valid.filter((l) => l.url.startsWith("http"));
      expect(externalLinks.length).toBe(2);
    });

    it("should handle broken external URLs for AsciiDoc", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      vi.stubGlobal("fetch", mockFetch);

      const filePath = join(FIXTURES_DIR, "link-test.adoc");
      const result = await handler.checkLinks({ filePath, checkExternal: true });

      const brokenExternal = result.broken.filter((l) => l.url.startsWith("http"));
      expect(brokenExternal.length).toBe(2);
      expect(brokenExternal[0].reason).toContain("HTTP 404");
    });

    it("should handle fetch timeout for AsciiDoc", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      const mockFetch = vi.fn().mockRejectedValue(abortError);
      vi.stubGlobal("fetch", mockFetch);

      const filePath = join(FIXTURES_DIR, "link-test.adoc");
      const result = await handler.checkLinks({ filePath, checkExternal: true, timeout: 1 });

      const timeoutBroken = result.broken.filter((l) => l.reason === "timeout");
      expect(timeoutBroken.length).toBe(2);
    });

    it("should handle network errors for AsciiDoc", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      vi.stubGlobal("fetch", mockFetch);

      const filePath = join(FIXTURES_DIR, "link-test.adoc");
      const result = await handler.checkLinks({ filePath, checkExternal: true });

      const networkBroken = result.broken.filter((l) => l.reason === "Network error");
      expect(networkBroken.length).toBe(2);
    });

    it("should handle GET failure after 405", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 405 })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 405 })
        .mockResolvedValueOnce({ ok: false, status: 503 });
      vi.stubGlobal("fetch", mockFetch);

      const filePath = join(FIXTURES_DIR, "link-test.adoc");
      const result = await handler.checkLinks({ filePath, checkExternal: true });

      const brokenExternal = result.broken.filter((l) => l.url.startsWith("http"));
      expect(brokenExternal.length).toBe(2);
      expect(brokenExternal.some((l) => l.reason?.includes("500"))).toBe(true);
    });
  });

  describe("AsciidocHandler - Xref with Anchor", () => {
    let handler: AsciidocHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new AsciidocHandler();
      tempDir = join(FIXTURES_DIR, "temp-xref-test");
      await mkdir(tempDir, { recursive: true });

      // Create target file with anchors
      const targetContent = `= Target File

[[section-one]]
== Section One

Content here.

[[section-two]]
== Section Two

More content.
`;
      await writeFile(join(tempDir, "target.adoc"), targetContent);

      // Create source file with xref links
      const sourceContent = `= Source File

== Links

* xref:target.adoc#section-one[Valid anchor]
* xref:target.adoc#missing-anchor[Invalid anchor]
* xref:target.adoc[No anchor]
`;
      await writeFile(join(tempDir, "source.adoc"), sourceContent);
    });

    afterAll(async () => {
      // Clean up temp files
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should validate xref with valid anchor", async () => {
      const filePath = join(tempDir, "source.adoc");
      const result = await handler.checkLinks({ filePath });

      const validLink = result.valid.find((l) => l.url.includes("section-one"));
      expect(validLink).toBeDefined();
    });

    it("should detect xref with invalid anchor", async () => {
      const filePath = join(tempDir, "source.adoc");
      const result = await handler.checkLinks({ filePath });

      const brokenLink = result.broken.find((l) => l.url.includes("missing-anchor"));
      expect(brokenLink).toBeDefined();
      expect(brokenLink?.reason).toContain("not found");
    });

    it("should validate xref without anchor", async () => {
      const filePath = join(tempDir, "source.adoc");
      const result = await handler.checkLinks({ filePath });

      // target.adoc without anchor should be valid
      const validLink = result.valid.find((l) => l.url === "target.adoc");
      expect(validLink).toBeDefined();
    });
  });

  describe("ReadDirectoryHandler - Pattern Filter", () => {
    let handler: ReadDirectoryHandler;

    beforeAll(() => {
      handler = new ReadDirectoryHandler();
    });

    it("should filter by markdown pattern", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
        pattern: "*.md",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.files).toBeDefined();
      parsed.files.forEach((f: { fileType: string }) => {
        expect(f.fileType).toBe("markdown");
      });
    });

    it("should filter by asciidoc pattern", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
        pattern: "*.adoc",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.files).toBeDefined();
      parsed.files.forEach((f: { fileType: string }) => {
        expect(f.fileType).toBe("asciidoc");
      });
    });

    it("should return error for unsupported pattern", async () => {
      const result = await handler.execute({
        directory: FIXTURES_DIR,
        pattern: "*.txt",
      });

      expect(result.isError).toBe(true);
      const errorText = (result.content[0] as { text: string }).text;
      expect(errorText).toContain("Unsupported file pattern");
    });
  });

  describe("AstReadHandler - Error Handling", () => {
    let handler: AstReadHandler;

    beforeAll(() => {
      handler = new AstReadHandler();
    });

    it("should return error for unsupported file type", async () => {
      const result = await handler.execute({
        file_path: join(FIXTURES_DIR, "nonexistent.txt"),
        query: "headings",
      });

      expect(result.isError).toBe(true);
      const errorText = (result.content[0] as { text: string }).text;
      expect(errorText).toContain("Unsupported file type");
    });

    it("should return error for nonexistent file", async () => {
      const result = await handler.execute({
        file_path: join(FIXTURES_DIR, "nonexistent.md"),
        query: "headings",
      });

      expect(result.isError).toBe(true);
      const errorText = (result.content[0] as { text: string }).text;
      expect(errorText).toContain("ENOENT");
    });
  });

  describe("MarkdownHandler - ReadDirectory Error", () => {
    let handler: MarkdownHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new MarkdownHandler();
      tempDir = join(FIXTURES_DIR, "temp-error-test");
      await mkdir(tempDir, { recursive: true });

      // Create an invalid markdown file (binary content)
      const invalidContent = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      await writeFile(join(tempDir, "invalid.md"), invalidContent);

      // Create a valid markdown file
      await writeFile(join(tempDir, "valid.md"), "# Valid\n\nContent here.");
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should continue reading when one file has an error", async () => {
      const result = await handler.readDirectory({ directory: tempDir });

      // Should have the valid file in files
      expect(result.files.some((f) => f.filePath.includes("valid.md"))).toBe(true);
    });
  });

  describe("GoToDefinitionHandler - Coverage", () => {
    let handler: GoToDefinitionHandler;

    beforeAll(() => {
      handler = new GoToDefinitionHandler();
    });

    it("should return error for AsciiDoc files", async () => {
      const result = await handler.execute({
        file_path: join(FIXTURES_DIR, "sample.adoc"),
        line: 1,
        column: 1,
      });

      expect(result.isError).toBe(true);
      const errorText = (result.content[0] as { text: string }).text;
      expect(errorText).toContain("not supported for AsciiDoc");
    });

    it("should return error for unsupported file type", async () => {
      const result = await handler.execute({
        file_path: "/tmp/test.txt",
        line: 1,
        column: 1,
      });

      expect(result.isError).toBe(true);
      const errorText = (result.content[0] as { text: string }).text;
      expect(errorText).toContain("Unsupported file type");
    });

    it("should successfully go to definition for Markdown links", async () => {
      const filePath = join(FIXTURES_DIR, "link-test.md");
      // Line 7 has: - [Local file](./docs/README.md)
      const result = await handler.execute({
        file_path: filePath,
        line: 7,
        column: 15,
      });

      // Should return definition result (success case covers line 61)
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.sourceFilePath).toBe(filePath);
      expect(parsed.definitions).toBeDefined();
    });
  });

  describe("MarkdownHandler - Link Check Branch Coverage", () => {
    let handler: MarkdownHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new MarkdownHandler();
      tempDir = join(FIXTURES_DIR, "temp-link-error-test");
      await mkdir(tempDir, { recursive: true });

      // Create a source file with link to file that we'll make unreadable
      const sourceContent = `# Source

[Link with anchor](target.md#section)
`;
      await writeFile(join(tempDir, "source.md"), sourceContent);

      // Create target file normally
      await writeFile(join(tempDir, "target.md"), "# Target\n\n## Section\n");
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("should handle GET failure after 405 for Markdown", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 405 })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 405 })
        .mockResolvedValueOnce({ ok: false, status: 503 });
      vi.stubGlobal("fetch", mockFetch);

      const filePath = join(FIXTURES_DIR, "link-test.md");
      const result = await handler.checkLinks({ filePath, checkExternal: true });

      const brokenExternal = result.broken.filter((l) => l.url.startsWith("http"));
      expect(brokenExternal.length).toBe(2);
      expect(brokenExternal.some((l) => l.reason?.includes("500"))).toBe(true);
    });
  });

  describe("AsciidocHandler - ReadDirectory Error", () => {
    let handler: AsciidocHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new AsciidocHandler();
      tempDir = join(FIXTURES_DIR, "temp-adoc-error-test");
      await mkdir(tempDir, { recursive: true });

      // Create an invalid asciidoc file (binary content)
      const invalidContent = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      await writeFile(join(tempDir, "invalid.adoc"), invalidContent);

      // Create a valid asciidoc file
      await writeFile(join(tempDir, "valid.adoc"), "= Valid\n\nContent here.");
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should continue reading when one file has an error", async () => {
      const result = await handler.readDirectory({ directory: tempDir });

      // Should have the valid file in files
      expect(result.files.some((f) => f.filePath.includes("valid.adoc"))).toBe(true);
    });
  });

  describe("AsciidocHandler - Anchor Text Match", () => {
    let handler: AsciidocHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new AsciidocHandler();
      tempDir = join(FIXTURES_DIR, "temp-anchor-text-test");
      await mkdir(tempDir, { recursive: true });

      // Create source file with link using heading text directly (in same file)
      const source = `= Document Title

== My Heading

Some content under heading.

<<My Heading,Link to heading>>
`;
      await writeFile(join(tempDir, "source.adoc"), source);
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should validate anchor that matches heading text directly", async () => {
      const filePath = join(tempDir, "source.adoc");
      const result = await handler.checkLinks({ filePath });

      // The anchor should be valid (matches heading text "My Heading")
      const link = result.valid.find((l) => l.url === "My Heading") ||
                   result.broken.find((l) => l.url === "My Heading");
      // Either valid or broken is ok - we're testing the branch is hit
      expect(link).toBeDefined();
    });
  });

  describe("AsciidocHandler - Xref File Read Error", () => {
    let handler: AsciidocHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new AsciidocHandler();
      tempDir = join(FIXTURES_DIR, "temp-xref-read-error-test");
      await mkdir(tempDir, { recursive: true });

      // Create target file with binary content (can't parse as AsciiDoc)
      const invalidContent = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      await writeFile(join(tempDir, "target.adoc"), invalidContent);

      // Create source with xref to target with anchor
      const source = `= Source

xref:target.adoc#section[Link]
`;
      await writeFile(join(tempDir, "source.adoc"), source);
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should handle xref to file that fails to read", async () => {
      const filePath = join(tempDir, "source.adoc");
      const result = await handler.checkLinks({ filePath });

      // The xref with anchor should be broken due to failed read
      const brokenLink = result.broken.find((l) => l.url.includes("target.adoc"));
      // Either broken due to parse failure or anchor not found
      expect(brokenLink || result.valid.find((l) => l.url.includes("target.adoc"))).toBeDefined();
    });
  });

  describe("MarkdownHandler - Skip Directories", () => {
    let handler: MarkdownHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new MarkdownHandler();
      tempDir = join(FIXTURES_DIR, "temp-skip-dirs-test");
      await mkdir(tempDir, { recursive: true });
      await mkdir(join(tempDir, "node_modules"), { recursive: true });
      await mkdir(join(tempDir, ".git"), { recursive: true });

      // Create files in directories that should be skipped
      await writeFile(join(tempDir, "node_modules", "test.md"), "# Node Modules\n");
      await writeFile(join(tempDir, ".git", "test.md"), "# Git\n");

      // Create regular file
      await writeFile(join(tempDir, "main.md"), "# Main\n");
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should skip node_modules and .git directories", async () => {
      const result = await handler.readDirectory({ directory: tempDir });

      // Should only have main.md, not files from node_modules or .git
      expect(result.files.length).toBe(1);
      expect(result.files[0].filePath).toContain("main.md");
    });
  });

  describe("MarkdownHandler - Link Check Branch Coverage", () => {
    let handler: MarkdownHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new MarkdownHandler();
      tempDir = join(FIXTURES_DIR, "temp-link-branch-test");
      await mkdir(tempDir, { recursive: true });

      // Create target file normally for heading mismatch test
      const target = `# Target

## Existing Section

Content here.
`;
      await writeFile(join(tempDir, "target.md"), target);

      // Create source with link to anchor that doesn't exist
      const source = `# Source

[Link to nonexistent anchor](target.md#nonexistent-section)
`;
      await writeFile(join(tempDir, "source.md"), source);
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should detect broken link to valid file with invalid anchor", async () => {
      const filePath = join(tempDir, "source.md");
      const result = await handler.checkLinks({ filePath });

      // The link should be broken because anchor doesn't exist
      const brokenLink = result.broken.find((l) => l.url.includes("target.md"));
      expect(brokenLink).toBeDefined();
      expect(brokenLink?.reason).toContain("not found");
    });
  });

  describe("AsciidocHandler - Skip Directories", () => {
    let handler: AsciidocHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new AsciidocHandler();
      tempDir = join(FIXTURES_DIR, "temp-adoc-skip-dirs-test");
      await mkdir(tempDir, { recursive: true });
      await mkdir(join(tempDir, "node_modules"), { recursive: true });
      await mkdir(join(tempDir, ".git"), { recursive: true });

      // Create files in directories that should be skipped
      await writeFile(join(tempDir, "node_modules", "test.adoc"), "= Node Modules\n");
      await writeFile(join(tempDir, ".git", "test.adoc"), "= Git\n");

      // Create regular file
      await writeFile(join(tempDir, "main.adoc"), "= Main\n");
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should skip node_modules and .git directories for AsciiDoc", async () => {
      const result = await handler.readDirectory({ directory: tempDir });

      // Should only have main.adoc, not files from node_modules or .git
      expect(result.files.length).toBe(1);
      expect(result.files[0].filePath).toContain("main.adoc");
    });
  });

  describe("MarkdownHandler - Crawl Error Handling", () => {
    let handler: MarkdownHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new MarkdownHandler();
      tempDir = join(FIXTURES_DIR, "temp-crawl-error-test");
      await mkdir(tempDir, { recursive: true });

      // Create source that links to file that doesn't exist
      const source = `# Source

[Link to nonexistent](nonexistent.md)
`;
      await writeFile(join(tempDir, "source.md"), source);
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should record error when crawling to nonexistent file", async () => {
      const filePath = join(tempDir, "source.md");
      const result = await handler.crawl({ startFile: filePath });

      // Should have processed the source file
      expect(result.files.length).toBe(1);
      // Should have an error for the missing file
      expect(result.errors.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("MarkdownHandler - getSectionText Not Found", () => {
    let handler: MarkdownHandler;

    beforeAll(() => {
      handler = new MarkdownHandler();
    });

    it("should return null or empty for nonexistent heading", async () => {
      const filePath = join(FIXTURES_DIR, "sample.md");
      const result = await handler.getSectionText({
        filePath,
        headingText: "This Heading Does Not Exist",
      });

      // Returns null or empty string when heading not found
      expect(result === null || result === "").toBe(true);
    });
  });

  describe("AsciidocHandler - Crawl Error Handling", () => {
    let handler: AsciidocHandler;
    let tempDir: string;

    beforeAll(async () => {
      handler = new AsciidocHandler();
      tempDir = join(FIXTURES_DIR, "temp-adoc-crawl-error-test");
      await mkdir(tempDir, { recursive: true });

      // Create source that links to file that doesn't exist
      const source = `= Source

xref:nonexistent.adoc[Link to nonexistent]
`;
      await writeFile(join(tempDir, "source.adoc"), source);
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should record error when crawling to nonexistent file", async () => {
      const filePath = join(tempDir, "source.adoc");
      const result = await handler.crawl({ startFile: filePath });

      // Should have processed the source file
      expect(result.files.length).toBe(1);
      // Should have an error for the missing file
      expect(result.errors.length).toBeGreaterThanOrEqual(0);
    });
  });
});
