import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Document, DocumentMeta, StorageConfig } from "../types.js";
import { DocumentMetaSchema } from "../types.js";
import { getErrorMessage } from "mcp-shared";
import { parentIds } from "../graph.js";

/**
 * Fields an update may set. A key that is present replaces the stored value,
 * even with undefined, so `requires` and `baseline` can be cleared.
 */
export interface DocumentUpdates {
  title?: string;
  content?: string;
  requires?: string | string[];
  baseline?: DocumentMeta["baseline"];
  code?: DocumentMeta["code"];
}

/**
 * Parse a markdown file with YAML frontmatter
 */
export function parseMarkdown(content: string): { meta: Record<string, unknown>; body: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    throw new Error("Invalid markdown format: missing frontmatter");
  }

  const meta = parseYaml(match[1]) as Record<string, unknown>;
  const body = match[2].trim();

  return { meta, body };
}

/**
 * Serialize document to markdown with frontmatter
 */
export function serializeMarkdown({ meta, content }: { meta: DocumentMeta; content: string }): string {
  // Drop undefined fields so they are absent from the file rather than null
  const frontmatter = stringifyYaml(JSON.parse(JSON.stringify(meta)));
  return `---\n${frontmatter}---\n\n${content}\n`;
}

/**
 * Generate a new ULID
 */
export function generateId(): string {
  return ulid();
}

/**
 * Get current ISO timestamp
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Markdown storage implementation
 */
export class MarkdownStorage {
  private basePath: string;
  private extension: string;

  constructor(config: StorageConfig) {
    this.basePath = config.basePath;
    this.extension = config.extension;

    // Ensure base directory exists
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Get file path for a document type and ID
   */
  private getFilePath({ type, id }: { type: string; id: string }): string {
    const typeDir = path.join(this.basePath, type);
    if (!existsSync(typeDir)) {
      mkdirSync(typeDir, { recursive: true });
    }
    return path.join(typeDir, `${id}${this.extension}`);
  }

  /**
   * Read a document by ID
   */
  async read(id: string): Promise<Document | null> {
    // Search in all type directories
    const types = this.getTypes();

    for (const type of types) {
      const filePath = this.getFilePath({ type: type, id: id });
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf-8");
        const { meta, body } = parseMarkdown(content);
        const parsed = DocumentMetaSchema.parse(meta);
        return { ...parsed, content: body, filePath };
      }
    }

    return null;
  }

  /**
   * List all documents, optionally filtered by type
   */
  async list(type?: string): Promise<Document[]> {
    const { documents } = await this.scan(type);
    return documents;
  }

  /**
   * List documents together with the files that could not be parsed, so a
   * check can report them instead of silently skipping them.
   */
  async scan(type?: string): Promise<{ documents: Document[]; invalid: { filePath: string; error: string }[] }> {
    const types = type ? [type] : this.getTypes();
    const documents: Document[] = [];
    const invalid: { filePath: string; error: string }[] = [];

    for (const t of types) {
      const typeDir = path.join(this.basePath, t);
      if (!existsSync(typeDir)) continue;

      const files = readdirSync(typeDir).filter(f => f.endsWith(this.extension));

      for (const file of files) {
        const filePath = path.join(typeDir, file);
        try {
          const content = readFileSync(filePath, "utf-8");
          const { meta, body } = parseMarkdown(content);
          const parsed = DocumentMetaSchema.parse(meta);
          documents.push({ ...parsed, content: body, filePath });
        } catch (error) {
          invalid.push({ filePath, error: getErrorMessage(error) });
        }
      }
    }

    return { documents, invalid };
  }

  /**
   * Create a new document
   */
  async create(
    { type, title, content, requires, baseline }: {
      type: string;
      title: string;
      content: string;
      requires?: string | string[];
      baseline?: DocumentMeta["baseline"];
    },
  ): Promise<Document> {
    const id = generateId();
    const timestamp = now();

    const meta: DocumentMeta = {
      id,
      type,
      title,
      requires,
      created: timestamp,
      updated: timestamp,
      baseline,
    };

    const filePath = this.getFilePath({ type: type, id: id });
    const markdown = serializeMarkdown({ meta: meta, content: content });
    writeFileSync(filePath, markdown, "utf-8");

    return { ...meta, content, filePath };
  }

  /**
   * Update an existing document
   */
  async update(
    { id, updates }: { id: string; updates: DocumentUpdates },
  ): Promise<Document | null> {
    const doc = await this.read(id);
    if (!doc) return null;

    const newMeta: DocumentMeta = {
      id: doc.id,
      type: doc.type,
      title: updates.title ?? doc.title,
      requires: "requires" in updates ? updates.requires : doc.requires,
      created: doc.created,
      updated: now(),
      baseline: "baseline" in updates ? updates.baseline : doc.baseline,
      code: "code" in updates ? updates.code : doc.code,
    };

    const newContent = updates.content ?? doc.content;
    const markdown = serializeMarkdown({ meta: newMeta, content: newContent });
    const filePath = this.getFilePath({ type: doc.type, id: id });
    writeFileSync(filePath, markdown, "utf-8");

    return { ...newMeta, content: newContent, filePath };
  }

  /**
   * Delete a document
   */
  async delete(id: string): Promise<boolean> {
    const doc = await this.read(id);
    if (!doc) return false;

    unlinkSync(doc.filePath);
    return true;
  }

  /**
   * Find documents that require the given document ID
   */
  async findDependents(id: string): Promise<Document[]> {
    const all = await this.list();
    return all.filter(doc => parentIds(doc).includes(id));
  }

  /**
   * Get all type directories
   */
  private getTypes(): string[] {
    if (!existsSync(this.basePath)) return [];
    return readdirSync(this.basePath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  }
}
