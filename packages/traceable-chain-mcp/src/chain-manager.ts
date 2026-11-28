import type {
  ChainConfig,
  CheckReport,
  CodeRef,
  Document,
  DocumentSummary,
  ImpactReport,
  LinkBaseline,
  TraceNode,
  ValidationError,
  ValidationResult,
} from "./types.js";
import { MarkdownStorage } from "./storage/markdown-storage.js";
import { ChainGraph, parentIds, summarize, toRequires } from "./graph.js";
import { expandCodePath, hashCode, hashDocument } from "./hash.js";
import { blockedIds, findBlockingAncestor, runCheck } from "./analysis/checker.js";
import type { RuleContext } from "./analysis/rules.js";
import { ParentRule, UnknownTypeRule } from "./analysis/rules.js";

/** What `confirm` re-baselined */
export interface ConfirmResult {
  document: DocumentSummary;
  links: string[];
  code: string[];
}

function describeDoc(doc: Document): string {
  return `${doc.type} "${doc.title}" (${doc.id})`;
}

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
  getTypes(): ChainConfig["types"] {
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

  /** Directory code paths are relative to */
  getCodeRoot(): string {
    return this.config.codeRoot ?? process.cwd();
  }

  /**
   * Validate that a parent ID is valid for a document type
   */
  async validateParent(params: {
    type: string;
    parentId?: string;
  }): Promise<{ valid: true } | { valid: false; error: string }> {
    const { type, parentId } = params;
    return this.validateParents({ type, parentIds: parentId === undefined ? [] : [parentId] });
  }

  /**
   * Validate a set of parent IDs for a document type. Every parent must exist
   * and be of an allowed type.
   */
  async validateParents(params: {
    type: string;
    parentIds: string[];
  }): Promise<{ valid: true } | { valid: false; error: string }> {
    const { type, parentIds: ids } = params;
    const graph = await this.loadGraph();
    const probe: Document = {
      id: "(new)", type, title: "", content: "", filePath: "", created: "", updated: "",
      requires: toRequires(ids),
    };
    const findings = new ParentRule().check(probe, this.ruleContext(graph));
    if (findings.length > 0) {
      return { valid: false, error: findings[0].message };
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
   * Trace dependency tree from a document. "up" nests parents under each
   * node, "down" nests children. Nodes with unresolved findings are marked.
   */
  async trace(params: { id: string; direction?: "up" | "down" }): Promise<TraceNode | null> {
    const { id, direction = "down" } = params;
    const graph = await this.loadGraph();
    const doc = graph.get(id);
    if (!doc) return null;

    const suspect = blockedIds(runCheck({ ctx: this.ruleContext(graph) }).findings);
    const next = direction === "up"
      ? (d: Document) => graph.parents(d)
      : (d: Document) => graph.children(d.id);
    return this.buildTrace({ doc, next, suspect, seen: new Set() });
  }

  private buildTrace(params: {
    doc: Document;
    next: (doc: Document) => Document[];
    suspect: Set<string>;
    seen: Set<string>;
  }): TraceNode {
    const { doc, next, suspect, seen } = params;
    const path = new Set(seen).add(doc.id);
    return {
      id: doc.id,
      type: doc.type,
      title: doc.title,
      ...(suspect.has(doc.id) ? { suspect: true } : {}),
      // A node already on the path is a cycle; stop rather than recurse forever
      children: next(doc)
        .filter(child => !path.has(child.id))
        .map(child => this.buildTrace({ doc: child, next, suspect, seen: path })),
    };
  }

  /**
   * Validate all documents for structural consistency (types and parents).
   * `check` is the full version, including drift.
   */
  async validate(): Promise<ValidationResult> {
    const graph = await this.loadGraph();
    const ctx = this.ruleContext(graph);
    const report = runCheck({ ctx, rules: [new UnknownTypeRule(), new ParentRule()] });
    const errors: ValidationError[] = report.findings.map(f => ({ id: f.id, type: f.type, error: f.message }));
    return { valid: errors.length === 0, errors };
  }

  /**
   * Run every mechanical check: structure, cycles, drift between linked
   * documents, drift between documents and code, and decisions not carried down.
   */
  async check(): Promise<CheckReport> {
    const { documents, invalid } = await this.storage.scan();
    const graph = new ChainGraph(documents);
    return runCheck({ ctx: this.ruleContext(graph), invalidFiles: invalid });
  }

  /**
   * What a change to a document, or to a code path, has to be checked
   * against (upstream, to the roots) and what it can invalidate (downstream).
   */
  async impact(params: { id?: string; path?: string }): Promise<ImpactReport> {
    const graph = await this.loadGraph();
    const subjects = this.resolveSubjects({ graph, ...params });
    const upstream = new Map<string, Document>();
    const downstream = new Map<string, Document>();
    const subjectIds = new Set(subjects.map(s => s.id));
    for (const subject of subjects) {
      for (const a of graph.ancestors(subject)) if (!subjectIds.has(a.id)) upstream.set(a.id, a);
      for (const d of graph.descendants(subject)) if (!subjectIds.has(d.id)) downstream.set(d.id, d);
    }
    return {
      subjects: subjects.map(summarize),
      upstream: [...upstream.values()].map(summarize),
      downstream: [...downstream.values()].map(summarize),
    };
  }

  private resolveSubjects(params: { graph: ChainGraph; id?: string; path?: string }): Document[] {
    const { graph, id, path } = params;
    if (id !== undefined) {
      const doc = graph.get(id);
      if (!doc) throw new Error(`Document "${id}" not found`);
      return [doc];
    }
    if (path === undefined) {
      throw new Error("Specify either id or path");
    }
    const root = this.getCodeRoot();
    const target = normalizeCodePath(path);
    return graph.documents.filter(doc => (doc.code ?? []).some(ref =>
      ref.path === path || expandCodePath({ root, pattern: ref.path }).some(file => file === target || file.startsWith(`${target}/`))));
  }

  // ─── Mutate Operations ──────────────────────────────────────────────────

  /**
   * Create a new document. Its links are confirmed at creation: the author
   * wrote it against the parents as they are now.
   */
  async create(params: {
    type: string;
    title: string;
    content: string;
    requires?: string | string[];
  }): Promise<Document> {
    const { type, title, content, requires } = params;
    // Validate type
    if (!this.isValidType(type)) {
      throw new Error(`Invalid type: "${type}". Valid types: ${Object.keys(this.config.types).join(", ")}`);
    }

    const ids = parentIds({ requires });
    const parentValidation = await this.validateParents({ type, parentIds: ids });
    if (!parentValidation.valid) {
      throw new Error(parentValidation.error);
    }

    const graph = await this.loadGraph();
    const selfHash = hashDocument({ title, content });
    const baseline: Record<string, LinkBaseline> = {};
    for (const pid of ids) {
      baseline[pid] = this.makeBaseline({ parent: graph.get(pid) as Document, selfHash });
    }
    return this.storage.create({
      type,
      title,
      content,
      requires: toRequires(ids),
      baseline: ids.length > 0 ? baseline : undefined,
    });
  }

  /**
   * Update an existing document. Its baselines are left alone, so the change
   * shows up in `check` both above (self_changed) and below (parent_changed).
   */
  async update(params: {
    id: string;
    updates: { title?: string; content?: string };
  }): Promise<Document> {
    const { id, updates } = params;
    const patch = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
    const doc = await this.storage.update({ id: id, updates: patch });
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
   * Link an existing document to a(nother) parent. The link is confirmed as
   * it is made.
   */
  async link(params: { id: string; parentId: string }): Promise<Document> {
    const { id, parentId } = params;
    const graph = await this.loadGraph();
    const doc = graph.get(id);
    if (!doc) {
      throw new Error(`Document "${id}" not found`);
    }

    // Validate the new parent
    const parentValidation = await this.validateParent({ type: doc.type, parentId });
    if (!parentValidation.valid) {
      throw new Error(parentValidation.error);
    }
    if (parentId === id || graph.descendants(doc).some(d => d.id === parentId)) {
      throw new Error(`Cannot link: "${parentId}" is below "${id}", so the link would make a cycle`);
    }

    const ids = [...new Set([...parentIds(doc), parentId])];
    const baseline = {
      ...doc.baseline,
      [parentId]: this.makeBaseline({ parent: graph.get(parentId) as Document, selfHash: hashDocument(doc) }),
    };
    return this.save({ id, updates: { requires: toRequires(ids), baseline } });
  }

  /**
   * Remove one parent link. A non-root document keeps at least one parent.
   */
  async unlink(params: { id: string; parentId: string }): Promise<Document> {
    const { id, parentId } = params;
    const doc = await this.storage.read(id);
    if (!doc) {
      throw new Error(`Document "${id}" not found`);
    }
    const ids = parentIds(doc);
    if (!ids.includes(parentId)) {
      throw new Error(`Document "${id}" is not linked to "${parentId}"`);
    }
    const remaining = ids.filter(pid => pid !== parentId);
    if (remaining.length === 0 && this.getRequiredParent(doc.type) !== null) {
      throw new Error(`Cannot unlink: ${doc.type} must keep at least one parent. Link the new parent first.`);
    }
    const baseline = Object.fromEntries(Object.entries(doc.baseline ?? {}).filter(([pid]) => pid !== parentId));
    return this.save({
      id,
      updates: { requires: toRequires(remaining), baseline: remaining.length > 0 ? baseline : undefined },
    });
  }

  /**
   * Declare that a document still holds against what is above it (its
   * parents) and what is below it (its code), as both are now.
   *
   * Resolution is top-down: if anything above this document is itself
   * unresolved, the upper decision has to be settled first, and this throws
   * naming it.
   */
  async confirm(params: { id: string; target?: string }): Promise<ConfirmResult> {
    const { id, target } = params;
    const { documents, invalid } = await this.storage.scan();
    const graph = new ChainGraph(documents);
    const doc = graph.get(id);
    if (!doc) {
      throw new Error(`Document "${id}" not found`);
    }
    const findings = runCheck({ ctx: this.ruleContext(graph), invalidFiles: invalid }).findings;
    const blocking = findBlockingAncestor({ graph, doc, findings });
    if (blocking) {
      throw new Error(`Resolve the upper decision first: ${describeDoc(blocking)} is unresolved. Run check and work top-down.`);
    }

    const plan = this.planConfirm({ doc, target, graph, findings });
    const selfHash = hashDocument(doc);
    const baseline = { ...doc.baseline };
    for (const pid of plan.links) {
      baseline[pid] = this.makeBaseline({ parent: graph.get(pid) as Document, selfHash });
    }
    const root = this.getCodeRoot();
    const at = new Date().toISOString();
    const code: CodeRef[] = (doc.code ?? []).map(ref =>
      plan.code.includes(ref.path) ? { path: ref.path, hash: hashCode({ root, pattern: ref.path }) ?? undefined, at } : ref);

    await this.save({ id, updates: { baseline: plan.links.length > 0 ? baseline : doc.baseline, code: doc.code ? code : undefined } });
    return { document: summarize(doc), links: plan.links, code: plan.code };
  }

  private planConfirm(params: {
    doc: Document;
    target?: string;
    graph: ChainGraph;
    findings: CheckReport["findings"];
  }): { links: string[]; code: string[] } {
    const { doc, target, graph, findings } = params;
    const links = parentIds(doc).filter(pid => graph.get(pid) !== undefined);
    const code = (doc.code ?? []).map(ref => ref.path);
    if (target === undefined) return { links, code };
    // Code sits below the document, so its own links have to hold first
    if (target === "code") {
      const ownBlocked = findings.some(f => f.id === doc.id && f.parentId !== undefined);
      if (ownBlocked) {
        throw new Error(`Confirm the links of ${describeDoc(doc)} to its parents before its code.`);
      }
      return { links: [], code };
    }
    if (!links.includes(target)) {
      throw new Error(`Document "${doc.id}" is not linked to "${target}"`);
    }
    return { links: [target], code: [] };
  }

  /**
   * Bind a document to source code. Paths are files, directories or globs
   * relative to the code root; each is confirmed as it is bound.
   */
  async bindCode(params: { id: string; paths: string[]; replace?: boolean }): Promise<Document> {
    const { id, paths, replace = false } = params;
    const doc = await this.storage.read(id);
    if (!doc) {
      throw new Error(`Document "${id}" not found`);
    }
    if (!this.config.types[doc.type]?.bindsCode) {
      const codeTypes = Object.entries(this.config.types).filter(([, c]) => c.bindsCode).map(([t]) => t);
      throw new Error(`Type "${doc.type}" does not bind code. Types that do: ${codeTypes.join(", ") || "(none)"}`);
    }
    const root = this.getCodeRoot();
    const at = new Date().toISOString();
    const bound = paths.map(p => {
      const hash = hashCode({ root, pattern: p });
      if (hash === null) throw new Error(`Code path "${p}" matches no files under ${root}`);
      return { path: p, hash, at };
    });
    const kept = replace ? [] : (doc.code ?? []).filter(ref => !paths.includes(ref.path));
    return this.save({ id, updates: { code: [...kept, ...bound] } });
  }

  /**
   * Accept the chain as it is now: give every link and code reference that
   * has no baseline one taken from the current state. Existing baselines are
   * left alone, so drift that is already visible stays visible. For adopting
   * documents written before baselines existed.
   */
  async baseline(): Promise<{ links: number; code: number }> {
    const graph = await this.loadGraph();
    const root = this.getCodeRoot();
    let links = 0;
    let code = 0;
    for (const doc of graph.documents) {
      const selfHash = hashDocument(doc);
      const missing = graph.parents(doc).filter(p => !doc.baseline?.[p.id]);
      const unhashed = (doc.code ?? []).filter(ref => ref.hash === undefined);
      if (missing.length === 0 && unhashed.length === 0) continue;
      const baseline = { ...doc.baseline };
      for (const parent of missing) baseline[parent.id] = this.makeBaseline({ parent, selfHash });
      const refs = (doc.code ?? []).map(ref =>
        ref.hash === undefined ? { ...ref, hash: hashCode({ root, pattern: ref.path }) ?? undefined } : ref);
      await this.save({ id: doc.id, updates: { baseline: missing.length > 0 ? baseline : doc.baseline, code: doc.code ? refs : undefined } });
      links += missing.length;
      code += unhashed.length;
    }
    return { links, code };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async loadGraph(): Promise<ChainGraph> {
    return new ChainGraph(await this.storage.list());
  }

  private ruleContext(graph: ChainGraph): RuleContext {
    const root = this.getCodeRoot();
    const cache = new Map<string, string | null>();
    return {
      config: this.config,
      graph,
      hashCode(pattern: string): string | null {
        if (!cache.has(pattern)) cache.set(pattern, hashCode({ root, pattern }));
        return cache.get(pattern) ?? null;
      },
    };
  }

  private makeBaseline(params: { parent: Document; selfHash: string }): LinkBaseline {
    return { parent: hashDocument(params.parent), self: params.selfHash, at: new Date().toISOString() };
  }

  private async save(params: Parameters<MarkdownStorage["update"]>[0]): Promise<Document> {
    const updated = await this.storage.update(params);
    if (!updated) {
      throw new Error(`Failed to update document "${params.id}"`);
    }
    return updated;
  }
}

function normalizeCodePath(p: string): string {
  return p.replace(/^\.\//, "").replace(/\/+$/, "");
}
