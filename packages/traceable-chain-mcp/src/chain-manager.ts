import type {
  ChainConfig,
  Document,
  TraceNode,
  ValidationError,
  ValidationResult,
} from "./types.js";
import { MarkdownStorage } from "./storage/markdown-storage.js";

/**
 * Chain manager - handles document operations with dependency enforcement
 */
export class ChainManager {
  private config: ChainConfig;
  private storage: MarkdownStorage;

  constructor(config: ChainConfig) {
    this.config = config;
    this.storage = new MarkdownStorage(config.storage ?? { basePath: "./docs", extension: ".md" });
  }

  /**
   * Get configured types
   */
  getTypes(): Record<string, { requires: string | string[] | null; description?: string }> {
    return this.config.types;
  }

  /**
   * Get root types (types that don't require a parent)
   */
  getRootTypes(): string[] {
    return Object.entries(this.config.types)
      .filter(([, cfg]) => cfg.requires === null)
      .map(([type]) => type);
  }

  /**
   * Check if a type is valid
   */
  isValidType(type: string): boolean {
    return type in this.config.types;
  }

  /**
   * Get required parent type(s) for a type
   */
  getRequiredParent(type: string): string | string[] | null {
    return this.config.types[type]?.requires ?? null;
  }

  /**
   * Validate that a parent ID is valid for a document type
   */
  async validateParent(type: string, parentId?: string): Promise<{ valid: boolean; error?: string }> {
    const requires = this.getRequiredParent(type);

    // Root type - should not have parent
    if (requires === null) {
      if (parentId) {
        return { valid: false, error: `Type "${type}" is a root type and should not have a parent` };
      }
      return { valid: true };
    }

    // Non-root type - must have parent
    if (!parentId) {
      const requiredTypes = Array.isArray(requires) ? requires.join(" or ") : requires;
      return { valid: false, error: `Type "${type}" requires a parent of type: ${requiredTypes}` };
    }

    // Validate parent exists and has correct type
    const parent = await this.storage.read(parentId);
    if (!parent) {
      return { valid: false, error: `Parent document "${parentId}" not found` };
    }

    const allowedTypes = Array.isArray(requires) ? requires : [requires];
    if (!allowedTypes.includes(parent.type)) {
      return {
        valid: false,
        error: `Parent document "${parentId}" has type "${parent.type}", but type "${type}" requires: ${allowedTypes.join(" or ")}`,
      };
    }

    return { valid: true };
  }

  // ─── Query Operations ───────────────────────────────────────────────────

  /**
   * Read a document by ID
   */
  async read(id: string): Promise<Document | null> {
    return this.storage.read(id);
  }

  /**
   * List documents, optionally filtered by type
   */
  async list(type?: string): Promise<Document[]> {
    if (type && !this.isValidType(type)) {
      throw new Error(`Invalid type: "${type}"`);
    }
    return this.storage.list(type);
  }

  /**
   * Trace dependency tree from a document
   */
  async trace(id: string, direction: "up" | "down" = "down"): Promise<TraceNode | null> {
    const doc = await this.storage.read(id);
    if (!doc) return null;

    if (direction === "up") {
      return this.traceUp(doc);
    }
    return this.traceDown(doc);
  }

  private async traceUp(doc: Document): Promise<TraceNode> {
    const node: TraceNode = {
      id: doc.id,
      type: doc.type,
      title: doc.title,
      children: [],
    };

    if (doc.requires) {
      const parent = await this.storage.read(doc.requires);
      if (parent) {
        node.children = [await this.traceUp(parent)];
      }
    }

    return node;
  }

  private async traceDown(doc: Document): Promise<TraceNode> {
    const dependents = await this.storage.findDependents(doc.id);

    return {
      id: doc.id,
      type: doc.type,
      title: doc.title,
      children: await Promise.all(dependents.map(d => this.traceDown(d))),
    };
  }

  /**
   * Validate all documents for consistency
   */
  async validate(): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const documents = await this.storage.list();

    for (const doc of documents) {
      // Check type is valid
      if (!this.isValidType(doc.type)) {
        errors.push({
          id: doc.id,
          type: doc.type,
          error: `Unknown type: "${doc.type}"`,
        });
        continue;
      }

      // Check parent relationship
      const parentValidation = await this.validateParent(doc.type, doc.requires);
      if (!parentValidation.valid) {
        errors.push({
          id: doc.id,
          type: doc.type,
          error: parentValidation.error!,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ─── Mutate Operations ──────────────────────────────────────────────────

  /**
   * Create a new document
   */
  async create(
    type: string,
    title: string,
    content: string,
    requires?: string,
  ): Promise<Document> {
    // Validate type
    if (!this.isValidType(type)) {
      throw new Error(`Invalid type: "${type}". Valid types: ${Object.keys(this.config.types).join(", ")}`);
    }

    // Validate parent
    const parentValidation = await this.validateParent(type, requires);
    if (!parentValidation.valid) {
      throw new Error(parentValidation.error);
    }

    return this.storage.create({ type: type, title: title, content: content, requires: requires });
  }

  /**
   * Update an existing document
   */
  async update(
    id: string,
    updates: { title?: string; content?: string },
  ): Promise<Document> {
    const doc = await this.storage.update({ id: id, updates: updates });
    if (!doc) {
      throw new Error(`Document "${id}" not found`);
    }
    return doc;
  }

  /**
   * Delete a document
   */
  async delete(id: string): Promise<void> {
    // Check for dependents
    const dependents = await this.storage.findDependents(id);
    if (dependents.length > 0) {
      const depList = dependents.map(d => `${d.id} (${d.type})`).join(", ");
      throw new Error(`Cannot delete: document has dependents: ${depList}`);
    }

    const deleted = await this.storage.delete(id);
    if (!deleted) {
      throw new Error(`Document "${id}" not found`);
    }
  }

  /**
   * Link an existing document to a parent (add requires)
   */
  async link(id: string, parentId: string): Promise<Document> {
    const doc = await this.storage.read(id);
    if (!doc) {
      throw new Error(`Document "${id}" not found`);
    }

    // Validate the new parent
    const parentValidation = await this.validateParent(doc.type, parentId);
    if (!parentValidation.valid) {
      throw new Error(parentValidation.error);
    }

    // Update the document with new requires
    // We need to rewrite the file with updated frontmatter
    const parent = await this.storage.read(parentId);
    if (!parent) {
      throw new Error(`Parent document "${parentId}" not found`);
    }

    // This is a special update - we need to modify requires
    // For now, we'll delete and recreate (not ideal but works)
    await this.storage.delete(id);
    return this.storage.create({ type: doc.type, title: doc.title, content: doc.content, requires: parentId });
  }
}
