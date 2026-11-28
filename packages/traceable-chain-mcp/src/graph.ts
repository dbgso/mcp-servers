import type { Document, DocumentSummary } from "./types.js";

/**
 * Parent IDs of a document. `requires` is a single ID in older documents
 * and a list once a document has more than one parent.
 */
export function parentIds(doc: { requires?: string | string[] }): string[] {
  if (doc.requires === undefined) return [];
  if (Array.isArray(doc.requires)) return doc.requires;
  return [doc.requires];
}

/**
 * The value to store in `requires`: absent for none, a string for one,
 * a list for several. Keeping single parents as a string leaves existing
 * files unchanged.
 */
export function toRequires(ids: string[]): string | string[] | undefined {
  if (ids.length === 0) return undefined;
  if (ids.length === 1) return ids[0];
  return ids;
}

export function summarize(doc: Document): DocumentSummary {
  return { id: doc.id, type: doc.type, title: doc.title };
}

/**
 * An in-memory view of the whole chain, built once per operation so that
 * walking up and down does not re-read the filesystem.
 */
export class ChainGraph {
  private readonly byId: Map<string, Document>;
  private readonly childrenOf = new Map<string, Document[]>();

  constructor(readonly documents: Document[]) {
    this.byId = new Map(documents.map(doc => [doc.id, doc]));
    for (const doc of documents) {
      for (const pid of parentIds(doc)) {
        const list = this.childrenOf.get(pid) ?? [];
        list.push(doc);
        this.childrenOf.set(pid, list);
      }
    }
  }

  get(id: string): Document | undefined {
    return this.byId.get(id);
  }

  parents(doc: Document): Document[] {
    return parentIds(doc)
      .map(pid => this.byId.get(pid))
      .filter((p): p is Document => p !== undefined);
  }

  children(id: string): Document[] {
    return this.childrenOf.get(id) ?? [];
  }

  /** Every ancestor, nearest first, each once. Safe on cycles. */
  ancestors(doc: Document): Document[] {
    return this.walk({ start: doc, next: d => this.parents(d) });
  }

  /** Every descendant, nearest first, each once. Safe on cycles. */
  descendants(doc: Document): Document[] {
    return this.walk({ start: doc, next: d => this.children(d.id) });
  }

  private walk(params: { start: Document; next: (doc: Document) => Document[] }): Document[] {
    const { start, next } = params;
    const seen = new Set<string>([start.id]);
    const result: Document[] = [];
    let frontier = [start];
    while (frontier.length > 0) {
      const upcoming: Document[] = [];
      for (const node of frontier.flatMap(next)) {
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        result.push(node);
        upcoming.push(node);
      }
      frontier = upcoming;
    }
    return result;
  }

  /** Whether following parents from `doc` comes back to `doc` */
  isInCycle(doc: Document): boolean {
    return this.ancestors(doc).some(a => parentIds(a).includes(doc.id)) || parentIds(doc).includes(doc.id);
  }
}
