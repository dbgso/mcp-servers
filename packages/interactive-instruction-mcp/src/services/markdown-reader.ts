import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import type { MarkdownSummary } from "../types/index.js";
import {
  runValidators,
  HasDescriptionValidator,
  NotExistsValidator,
  ExistsValidator,
  ValidIdValidator,
} from "./validators.js";
import { ID_SEPARATOR, resolveDocumentPathOrThrow } from "./document-id.js";
import { MISSING_DESCRIPTION_PLACEHOLDER } from "./metadata-completeness.js";
import { describeScope, EMPTY_SCOPE, isManaged, type DocumentScope } from "./document-scope.js";
import { parseFrontmatter, updateFrontmatter } from "../utils/frontmatter-parser.js";
import { formatDocumentListItem, withTrailingNewline } from "../utils/string-utils.js";

export interface AddResult {
  success: boolean;
  error?: string;
  path?: string;
}

export interface CategoryInfo {
  id: string;
  docCount: number;
}

interface CacheEntry {
  documents: MarkdownSummary[];
  categories: CategoryInfo[];
  timestamp: number;
}

/** What a listing answers with: the documents at this level and what is below. */
export interface Listing {
  documents: MarkdownSummary[];
  categories: CategoryInfo[];
}

type RenameCheck = { refusal: AddResult } | { refusal: null; replacing: boolean };

const CACHE_TTL = 60_000; // 1 minute

export class MarkdownReader {
  private readonly directory: string;
  private readonly scope: DocumentScope;
  private cache: CacheEntry | null = null;

  constructor(directory: string, scope: DocumentScope = EMPTY_SCOPE) {
    this.directory = path.resolve(directory);
    this.scope = scope;
  }

  /**
   * Whether this server manages the document. Enforced at the scan, so every
   * feature derived from the listing -- search, lint, backlinks, the graph --
   * inherits it without each having to remember.
   */
  isManaged(id: string): boolean {
    return isManaged({ id, scope: this.scope });
  }

  /** The configured scope, for callers that report on the corpus. */
  getScope(): DocumentScope {
    return this.scope;
  }

  /**
   * Convert hierarchical ID to file path
   * "git__workflow" -> "git/workflow.md"
   */
  private idToPath(id: string): string {
    return resolveDocumentPathOrThrow({ directory: this.directory, id });
  }

  /**
   * The documents directory this reader serves, resolved. Callers scope their
   * own per-server state by it, so that two servers on one machine do not share
   * a store keyed by document id.
   */
  getDirectory(): string {
    return this.directory;
  }

  /**
   * Get the file path for a document ID (public accessor)
   */
  getFilePath(id: string): string {
    return this.idToPath(id);
  }

  /**
   * Convert file path to hierarchical ID
   * "git/workflow.md" -> "git__workflow"
   */
  private pathToId(filePath: string): string {
    const relativePath = path.relative(this.directory, filePath);
    const withoutExt = relativePath.slice(0, -3); // remove .md
    return withoutExt.split(path.sep).join(ID_SEPARATOR);
  }

  /**
   * Recursively scan directory for markdown files
   */
  private async scanDirectory(dir: string): Promise<MarkdownSummary[]> {
    const summaries: MarkdownSummary[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        summaries.push(...(await this.scanEntry({ dir, entry })));
      }
    } catch (error) {
      rethrowUnlessMissing(error);
    }

    return summaries;
  }

  /** What one entry contributes: its whole subtree, one document, or nothing. */
  private async scanEntry(params: { dir: string; entry: Dirent }): Promise<MarkdownSummary[]> {
    const { dir, entry } = params;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) return this.scanDirectory(fullPath);
    return this.scanFile({ fullPath, entry });
  }

  private async scanFile(params: { fullPath: string; entry: Dirent }): Promise<MarkdownSummary[]> {
    const { fullPath, entry } = params;
    if (!isMarkdownFile(entry)) return [];

    const id = this.pathToId(fullPath);
    if (!this.isManaged(id)) return [];

    const metadata = await this.extractMetadata(fullPath);
    return [
      {
        id,
        description: metadata.description,
        whenToUse: metadata.whenToUse,
        relatedDocs: metadata.relatedDocs,
      },
    ];
  }

  /**
   * Build category info from documents
   */
  private buildCategories(documents: MarkdownSummary[]): CategoryInfo[] {
    const counts = new Map<string, number>();

    for (const doc of documents) {
      const parts = doc.id.split(ID_SEPARATOR);
      if (parts.length === 1) continue;
      increment({ counts, key: parts[0] });
    }

    return sortedCategories(counts);
  }

  /**
   * Get or refresh cache
   */
  private async getCache(): Promise<CacheEntry> {
    const now = Date.now();

    if (this.cache && now - this.cache.timestamp < CACHE_TTL) {
      return this.cache;
    }

    const documents = await this.scanDirectory(this.directory);
    documents.sort((a, b) => a.id.localeCompare(b.id));
    const categories = this.buildCategories(documents);

    this.cache = { documents, categories, timestamp: now };
    return this.cache;
  }

  /**
   * Invalidate cache (called after add/update)
   */
  invalidateCache(): void {
    this.cache = null;
  }

  /**
   * List documents with optional filtering
   * @param parentId - Filter by parent category (e.g., "git" shows git__* docs)
   * @param recursive - If true, show all nested docs; if false, show immediate children only
   */
  async listDocuments(params?: {
    parentId?: string;
    recursive?: boolean;
  }): Promise<Listing> {
    return listing({ cache: await this.getCache(), request: params ?? {} });
  }

  /**
   * Check if ID is a category (directory) rather than a document
   */
  async isCategory(id: string): Promise<boolean> {
    const cache = await this.getCache();
    const prefix = id + ID_SEPARATOR;
    return cache.documents.some((d) => d.id.startsWith(prefix));
  }

  formatDocumentList(params: {
    documents: MarkdownSummary[];
    categories: CategoryInfo[];
  }): string {
    const { documents, categories } = params;
    if (isEmptyListing({ documents, categories })) {
      return "No markdown documents found.";
    }

    return [
      "Available documents:",
      "",
      ...categorySection(categories),
      ...documentSection({ documents, categories }),
    ].join("\n");
  }

  async getDocumentContent(id: string): Promise<string | null> {
    if (!this.isManaged(id)) return null;
    const filePath = this.idToPath(id);

    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (error) {
      return nullIfMissing(error);
    }
  }

  async documentExists(id: string): Promise<boolean> {
    if (!this.isManaged(id)) return false;
    const filePath = this.idToPath(id);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async addDocument(params: {
    id: string;
    content: string;
  }): Promise<AddResult> {
    const { id, content } = params;

    const refusal = await this.refuseAdd({ id, content });
    if (refusal !== null) return refusal;

    return this.writeNewDocument({ id, content });
  }

  /**
   * The first reason an `add` is refused, or null when there is none.
   *
   * Containment first so that a traversing id gets the containment error
   * rather than "outside this server's scope", which would send the caller
   * looking at configuration instead of at the id. Not a safety ordering --
   * `isManaged` only compares strings, and the containment that matters is
   * enforced inside `idToPath` whichever way round these two sit. Both run
   * before `documentExists`, which resolves the id.
   */
  private async refuseAdd(params: { id: string; content: string }): Promise<AddResult | null> {
    const { id, content } = params;

    return (
      failureOf(runValidators({ validators: [new ValidIdValidator({ id })] })) ??
      unmanagedResult({ reader: this, ids: [id] }) ??
      failureOf(await this.validateNewDocument({ id, content }))
    );
  }

  private async validateNewDocument(params: { id: string; content: string }): Promise<AddResult> {
    const { id, content } = params;

    return runValidators({
      validators: [
        new HasDescriptionValidator({ description: this.parseDescription(content) }),
        new NotExistsValidator({ id, exists: await this.documentExists(id) }),
      ],
    });
  }

  private async writeNewDocument(params: { id: string; content: string }): Promise<AddResult> {
    const { id, content } = params;

    try {
      const filePath = this.idToPath(id);
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, withTrailingNewline(content), "utf-8");
      this.invalidateCache();
      return { success: true, path: filePath };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add document: ${(error as Error).message}`,
      };
    }
  }

  async updateDocument(params: {
    id: string;
    content: string;
  }): Promise<AddResult> {
    const { id, content } = params;

    const refusal = await this.refuseUpdate({ id, content });
    if (refusal !== null) return refusal;

    return this.writeExistingDocument({ id, content });
  }

  private async refuseUpdate(params: { id: string; content: string }): Promise<AddResult | null> {
    const { id, content } = params;

    return (
      unmanagedResult({ reader: this, ids: [id] }) ??
      failureOf(
        runValidators({
          validators: [
            new HasDescriptionValidator({ description: this.parseDescription(content) }),
            new ExistsValidator({ id, exists: await this.documentExists(id) }),
          ],
        })
      )
    );
  }

  private async writeExistingDocument(params: { id: string; content: string }): Promise<AddResult> {
    const { id, content } = params;

    try {
      const filePath = this.idToPath(id);
      await fs.writeFile(filePath, withTrailingNewline(content), "utf-8");
      this.invalidateCache();
      return { success: true, path: filePath };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update document: ${(error as Error).message}`,
      };
    }
  }

  async deleteDocument(id: string): Promise<AddResult> {
    const refusal = await this.refuseDelete(id);
    if (refusal !== null) return refusal;

    return this.unlinkDocument(id);
  }

  private async refuseDelete(id: string): Promise<AddResult | null> {
    const outOfScope = unmanagedResult({ reader: this, ids: [id] });
    if (outOfScope !== null) return outOfScope;

    const exists = await this.documentExists(id);
    if (!exists) {
      return {
        success: false,
        error: `Document "${id}" not found.`,
      };
    }

    return null;
  }

  private async unlinkDocument(id: string): Promise<AddResult> {
    try {
      const filePath = this.idToPath(id);
      await fs.unlink(filePath);

      // Try to remove empty parent directories
      const dir = path.dirname(filePath);
      await this.removeEmptyDirs(dir);

      this.invalidateCache();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete document: ${(error as Error).message}`,
      };
    }
  }


  /**
   * Find documents that reference the given ID in their relatedDocs
   */
  async findBacklinks(id: string): Promise<MarkdownSummary[]> {
    const cache = await this.getCache();
    return cache.documents.filter(
      (doc) => doc.relatedDocs?.includes(id)
    );
  }

  async renameDocument(params: {
    oldId: string;
    newId: string;
    overwrite?: boolean;
    updateBacklinks?: boolean;
  }): Promise<AddResult & { updatedBacklinks?: string[] }> {
    const check = await this.checkRename(params);
    if (check.refusal !== null) return check.refusal;

    return this.moveDocument({ ...params, replacing: check.replacing });
  }

  /**
   * Whether the rename may go ahead, and the one fact the move needs from the
   * checks.
   *
   * `replacing` travels with the verdict because the same answer decides both
   * things: whether to refuse an overwrite nobody asked for, and whether the
   * move has a file to remove first. Asking the filesystem twice would be the
   * only alternative.
   */
  private async checkRename(params: {
    oldId: string;
    newId: string;
    overwrite?: boolean;
  }): Promise<RenameCheck> {
    const { oldId, newId } = params;

    const outOfScope = unmanagedResult({ reader: this, ids: [oldId, newId] });
    if (outOfScope !== null) return { refusal: outOfScope };

    const oldExists = await this.documentExists(oldId);
    if (!oldExists) {
      return { refusal: { success: false, error: `Document "${oldId}" not found.` } };
    }

    return this.checkRenameTarget(params);
  }

  private async checkRenameTarget(params: {
    newId: string;
    overwrite?: boolean;
  }): Promise<RenameCheck> {
    const { newId, overwrite } = params;

    const newExists = await this.documentExists(newId);
    if (wouldClobber({ newExists, overwrite })) {
      return { refusal: { success: false, error: `Document "${newId}" already exists.` } };
    }

    return { refusal: null, replacing: newExists };
  }

  private async moveDocument(params: {
    oldId: string;
    newId: string;
    replacing: boolean;
    updateBacklinks?: boolean;
  }): Promise<AddResult & { updatedBacklinks?: string[] }> {
    const { oldId, newId, replacing } = params;

    try {
      const oldPath = this.idToPath(oldId);
      const newPath = this.idToPath(newId);

      // Delete existing file if overwriting
      if (replacing) {
        await fs.unlink(newPath);
      }

      // Create new directory if needed
      const newDir = path.dirname(newPath);
      await fs.mkdir(newDir, { recursive: true });

      // Move the file
      await fs.rename(oldPath, newPath);

      // Try to remove empty parent directories from old location
      const oldDir = path.dirname(oldPath);
      await this.removeEmptyDirs(oldDir);

      const updatedBacklinks = await this.retargetBacklinks(params);

      this.invalidateCache();
      return { success: true, updatedBacklinks };
    } catch (error) {
      return {
        success: false,
        error: `Failed to rename document: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Point the documents that referenced `oldId` at `newId`.
   *
   * Inside the rename rather than left to the caller: a rename that moved the
   * file and left the references behind is the failure nobody notices until the
   * links have gone cold.
   */
  private async retargetBacklinks(params: {
    oldId: string;
    newId: string;
    updateBacklinks?: boolean;
  }): Promise<string[]> {
    const { updateBacklinks = true } = params;
    if (!updateBacklinks) return [];

    return this.rewriteBacklinks(params);
  }

  /** The ids actually changed, which is not every document that was looked at. */
  private async rewriteBacklinks(params: { oldId: string; newId: string }): Promise<string[]> {
    const { oldId, newId } = params;
    const updatedBacklinks: string[] = [];

    for (const doc of await this.findBacklinks(oldId)) {
      const updated = await this.updateRelatedDocsReference({
        docId: doc.id,
        oldRef: oldId,
        newRef: newId,
      });
      if (updated) {
        updatedBacklinks.push(doc.id);
      }
    }

    return updatedBacklinks;
  }

  /**
   * Update a reference in a document's relatedDocs
   */
  private async updateRelatedDocsReference(params: {
    docId: string;
    oldRef: string;
    newRef: string;
  }): Promise<boolean> {
    const { docId, oldRef, newRef } = params;
    const content = await this.getDocumentContent(docId);
    if (!content) return false;

    const frontmatter = parseFrontmatter(content);
    const retargeted = retargetRef({ relatedDocs: frontmatter.relatedDocs, oldRef, newRef });
    if (retargeted === null) return false;

    frontmatter.relatedDocs = retargeted;
    const newContent = updateFrontmatter({ content, frontmatter });
    const filePath = this.idToPath(docId);
    // A backlink rewrite touches a document nobody asked about, so it least of
    // all should leave a mark on its last line.
    await fs.writeFile(filePath, withTrailingNewline(newContent), "utf-8");
    return true;
  }

  private async removeEmptyDirs(dir: string): Promise<void> {
    if (!this.isPrunable(dir)) return;

    try {
      await this.pruneIfEmpty(dir);
    } catch {
      // Ignore errors (directory not empty or doesn't exist)
    }
  }

  /** The documents directory itself stays, and nothing above it is ours to remove. */
  private isPrunable(dir: string): boolean {
    return dir !== this.directory && dir.startsWith(this.directory);
  }

  private async pruneIfEmpty(dir: string): Promise<void> {
    const entries = await fs.readdir(dir);
    if (entries.length > 0) return;

    await fs.rmdir(dir);
    // Recursively try parent
    await this.removeEmptyDirs(path.dirname(dir));
  }

  private async extractMetadata(
    filePath: string
  ): Promise<{ description: string; whenToUse?: string[]; relatedDocs?: string[] }> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return this.parseMetadata(content);
    } catch {
      return { description: "(Unable to read file)" };
    }
  }

  /**
   * Parse metadata from content (frontmatter or first paragraph)
   */
  parseMetadata(content: string): {
    description: string;
    whenToUse?: string[];
    relatedDocs?: string[];
  } {
    // Try frontmatter first
    const frontmatter = parseFrontmatter(content);
    if (frontmatter.description) {
      return {
        description: this.truncateDescription(frontmatter.description),
        whenToUse: frontmatter.whenToUse,
        relatedDocs: frontmatter.relatedDocs,
      };
    }

    // Fallback to first paragraph after title (but still include metadata from frontmatter)
    const description = this.parseDescriptionFromBody(content);
    return {
      description,
      whenToUse: frontmatter.whenToUse,
      relatedDocs: frontmatter.relatedDocs,
    };
  }

  /**
   * For validation - get just the description
   */
  parseDescription(content: string): string {
    return this.parseMetadata(content).description;
  }

  private parseDescriptionFromBody(content: string): string {
    const descriptionLines = firstParagraphAfterTitle(content);
    if (descriptionLines.length === 0) {
      return MISSING_DESCRIPTION_PLACEHOLDER;
    }

    return this.truncateDescription(descriptionLines.join(" "));
  }

  private truncateDescription(description: string): string {
    const maxLength = 150;
    if (description.length > maxLength) {
      return description.slice(0, maxLength - 3) + "...";
    }
    return description;
  }
}

/**
 * The first block of prose under the `# ` title.
 *
 * Blank lines between the title and the paragraph are spacing; the paragraph
 * itself ends at the next blank line or the next heading, so a document whose
 * first section follows the title immediately does not end up describing itself
 * with that section's heading.
 */
function firstParagraphAfterTitle(content: string): string[] {
  const lines = content.split("\n").map((line) => line.trim());

  const titleAt = lines.findIndex((line) => line.startsWith("# "));
  if (titleAt === -1) return [];

  const under = lines.slice(titleAt + 1);
  const firstContent = under.findIndex((line) => line !== "");
  if (firstContent === -1) return [];

  return takeProse(under.slice(firstContent));
}

/** From the first prose line, up to whatever ends the paragraph. */
function takeProse(lines: string[]): string[] {
  const end = lines.findIndex((line) => !isProse(line));
  if (end === -1) return lines;
  return lines.slice(0, end);
}

function isProse(line: string): boolean {
  return line !== "" && !line.startsWith("#");
}

/**
 * `relatedDocs` with `oldRef` pointed at `newRef`, or null when the document
 * does not mention it -- which is the difference between a rewrite and writing a
 * document back unchanged.
 */
function retargetRef(params: {
  relatedDocs: string[] | undefined;
  oldRef: string;
  newRef: string;
}): string[] | null {
  const { relatedDocs, oldRef, newRef } = params;
  if (relatedDocs?.includes(oldRef) !== true) return null;

  return relatedDocs.map((ref) => (ref === oldRef ? newRef : ref));
}

/** Replacing a document is allowed, but only when the caller asked for it. */
function wouldClobber(params: { newExists: boolean; overwrite?: boolean }): boolean {
  const { newExists, overwrite = false } = params;
  return newExists && !overwrite;
}

/** A failed validation is the result to return; a passed one refuses nothing. */
function failureOf(result: AddResult): AddResult | null {
  if (result.success) return null;
  return result;
}

/**
 * A documents directory that is not there yet is an empty corpus rather than a
 * failure: it is created by the first `add`.
 */
function rethrowUnlessMissing(error: unknown): void {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

/** A document that is not there reads as absent; anything else is a real failure. */
function nullIfMissing(error: unknown): null {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
  throw error;
}

function isMarkdownFile(entry: Dirent): boolean {
  return entry.isFile() && entry.name.endsWith(".md");
}

function increment(params: { counts: Map<string, number>; key: string }): void {
  const { counts, key } = params;
  counts.set(key, (counts.get(key) || 0) + 1);
}

/** By id, so the order does not depend on the order the directory was scanned in. */
function sortedCategories(counts: Map<string, number>): CategoryInfo[] {
  return Array.from(counts.entries())
    .map(([id, docCount]) => ({ id, docCount }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function listing(params: {
  cache: CacheEntry;
  request: { parentId?: string; recursive?: boolean };
}): Listing {
  const { cache, request } = params;
  const { parentId, recursive = false } = request;

  if (!parentId) return rootListing({ cache, recursive });
  return childListing({ cache, parentId, recursive });
}

/**
 * Without `recursive`, one level plus the names of the categories below it: that
 * is what lets a caller ask for the next level by name instead of reading the
 * whole corpus to find it.
 */
function rootListing(params: { cache: CacheEntry; recursive: boolean }): Listing {
  const { cache, recursive } = params;
  if (recursive) return { documents: cache.documents, categories: [] };

  const rootDocs = cache.documents.filter((d) => !d.id.includes(ID_SEPARATOR));
  return { documents: rootDocs, categories: cache.categories };
}

function childListing(params: {
  cache: CacheEntry;
  parentId: string;
  recursive: boolean;
}): Listing {
  const { cache, parentId, recursive } = params;

  const prefix = parentId + ID_SEPARATOR;
  const filtered = cache.documents.filter((d) => d.id.startsWith(prefix));
  if (recursive) return { documents: filtered, categories: [] };

  return {
    documents: filtered.filter((doc) => isImmediateChild({ doc, prefix })),
    categories: sortedCategories(subCategoryCounts({ documents: filtered, prefix, parentId })),
  };
}

function isImmediateChild(params: { doc: MarkdownSummary; prefix: string }): boolean {
  return !params.doc.id.slice(params.prefix.length).includes(ID_SEPARATOR);
}

function subCategoryCounts(params: {
  documents: MarkdownSummary[];
  prefix: string;
  parentId: string;
}): Map<string, number> {
  const { documents, prefix, parentId } = params;
  const counts = new Map<string, number>();

  for (const doc of documents) {
    const parts = doc.id.slice(prefix.length).split(ID_SEPARATOR);
    if (parts.length === 1) continue;
    increment({ counts, key: parentId + ID_SEPARATOR + parts[0] });
  }

  return counts;
}

function isEmptyListing(params: Listing): boolean {
  return params.documents.length === 0 && params.categories.length === 0;
}

function categorySection(categories: CategoryInfo[]): string[] {
  if (categories.length === 0) return [];

  return [
    "**Categories:**",
    ...categories.map((cat) => `- **${cat.id}/** (${cat.docCount} docs)`),
    "",
  ];
}

function documentSection(params: Listing): string[] {
  const { documents, categories } = params;
  if (documents.length === 0) return [];

  return [...documentsHeading(categories), ...documents.map(listItemOf)];
}

/** Only worth a heading when the categories above it need telling apart from it. */
function documentsHeading(categories: CategoryInfo[]): string[] {
  if (categories.length === 0) return [];
  return ["**Documents:**"];
}

function listItemOf(doc: MarkdownSummary): string {
  return formatDocumentListItem({
    id: doc.id,
    description: doc.description,
    whenToUse: doc.whenToUse,
    relatedDocs: doc.relatedDocs,
  });
}

/**
 * Refuse a write that would touch a document this server does not manage.
 *
 * Returned rather than thrown: these are ordinary results a caller reports, not
 * programming errors. Reads simply come back empty; writes say why, because
 * silently doing nothing would look like success.
 */
function unmanagedResult(params: {
  reader: MarkdownReader;
  ids: string[];
}): AddResult | null {
  const outside = params.ids.filter((id) => !params.reader.isManaged(id));
  if (outside.length === 0) return null;
  return {
    success: false,
    error: `Outside this server's scope: ${outside.join(", ")}. ${describeScope(params.reader.getScope())}`.trim(),
  };
}
