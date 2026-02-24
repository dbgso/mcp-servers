/**
 * Generic structure diff utility for comparing AST summaries.
 * Used by ast-typescript-mcp and ast-file-mcp for diff_structure tool.
 */

/**
 * Interface for items that can be compared in a structural diff.
 * Items are identified by a unique key and have a kind/type.
 */
export interface DiffableItem {
  /** Unique identifier for matching (e.g., name for declarations, text for headings) */
  key: string;
  /** Type/kind of the item (e.g., "function", "class", "heading") */
  kind: string;
  /** Line number in the source file */
  line: number;
  /** Additional properties for detailed comparison */
  properties?: Record<string, unknown>;
}

/**
 * Represents a single change in the diff.
 */
export interface DiffChange {
  /** The unique key of the changed item */
  key: string;
  /** The kind/type of the item */
  kind: string;
  /** Line number in file A (for removed/modified) */
  lineA?: number;
  /** Line number in file B (for added/modified) */
  lineB?: number;
  /** Details about what changed (for modified items) */
  details?: string;
}

/**
 * Result of comparing two structures.
 */
export interface DiffResult {
  /** Items that exist in B but not in A */
  added: DiffChange[];
  /** Items that exist in A but not in B */
  removed: DiffChange[];
  /** Items that exist in both but have differences */
  modified: DiffChange[];
  /** Human-readable summary of changes */
  summary: string;
}

/**
 * Options for diff comparison.
 */
export interface DiffOptions {
  /** Comparison level: summary (name+kind only) or detailed (includes properties) */
  level: "summary" | "detailed";
}

/**
 * Compare two lists of diffable items and return the structural differences.
 *
 * Algorithm:
 * 1. Build a map of items in A by key
 * 2. Build a map of items in B by key
 * 3. Items in B but not in A = added
 * 4. Items in A but not in B = removed
 * 5. Items in both = check for modifications (kind change, property changes)
 *
 * @param params.itemsA - Items from file A
 * @param params.itemsB - Items from file B
 * @param params.options - Comparison options
 * @returns Diff result with added, removed, modified items and summary
 */
export function diffStructures(params: {
  itemsA: DiffableItem[];
  itemsB: DiffableItem[];
  options?: DiffOptions;
}): DiffResult {
  const { itemsA, itemsB, options = { level: "summary" } } = params;
  const mapA = new Map<string, DiffableItem>();
  const mapB = new Map<string, DiffableItem>();

  // Build maps
  for (const item of itemsA) {
    mapA.set(item.key, item);
  }
  for (const item of itemsB) {
    mapB.set(item.key, item);
  }

  const added: DiffChange[] = [];
  const removed: DiffChange[] = [];
  const modified: DiffChange[] = [];

  // Find added items (in B but not in A)
  for (const [key, itemB] of mapB) {
    if (!mapA.has(key)) {
      added.push({
        key,
        kind: itemB.kind,
        lineB: itemB.line,
      });
    }
  }

  // Find removed items (in A but not in B)
  for (const [key, itemA] of mapA) {
    if (!mapB.has(key)) {
      removed.push({
        key,
        kind: itemA.kind,
        lineA: itemA.line,
      });
    }
  }

  // Find modified items (in both A and B)
  for (const [key, itemA] of mapA) {
    const itemB = mapB.get(key);
    if (!itemB) continue;

    const changes: string[] = [];

    // Check kind change
    if (itemA.kind !== itemB.kind) {
      changes.push(`kind: ${itemA.kind} -> ${itemB.kind}`);
    }

    // Check line change (only in detailed mode, indicates move)
    if (options.level === "detailed" && itemA.line !== itemB.line) {
      changes.push(`line: ${itemA.line} -> ${itemB.line}`);
    }

    // Check property changes in detailed mode
    if (options.level === "detailed" && itemA.properties && itemB.properties) {
      const propChanges = diffProperties({ propsA: itemA.properties, propsB: itemB.properties });
      if (propChanges) {
        changes.push(propChanges);
      }
    }

    if (changes.length > 0) {
      modified.push({
        key,
        kind: itemB.kind,
        lineA: itemA.line,
        lineB: itemB.line,
        details: changes.join("; "),
      });
    }
  }

  // Sort by line number for consistent output
   
  added.sort((a, b) => (a.lineB ?? 0) - (b.lineB ?? 0));
   
  removed.sort((a, b) => (a.lineA ?? 0) - (b.lineA ?? 0));
   
  modified.sort((a, b) => (a.lineB ?? 0) - (b.lineB ?? 0));

  // Generate summary
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`Added ${added.length}`);
  }
  if (removed.length > 0) {
    parts.push(`Removed ${removed.length}`);
  }
  if (modified.length > 0) {
    parts.push(`Modified ${modified.length}`);
  }

  const summary = parts.length > 0 ? parts.join(", ") : "No changes";

  return {
    added,
    removed,
    modified,
    summary,
  };
}

/**
 * Compare two property objects and return a description of differences.
 */
function diffProperties(params: {
  propsA: Record<string, unknown>;
  propsB: Record<string, unknown>;
}): string | null {
  const { propsA, propsB } = params;
  const changes: string[] = [];
  const allKeys = new Set([...Object.keys(propsA), ...Object.keys(propsB)]);

  for (const key of allKeys) {
    const valueA = propsA[key];
    const valueB = propsB[key];

    if (valueA === undefined && valueB !== undefined) {
      changes.push(`+${key}`);
    } else if (valueA !== undefined && valueB === undefined) {
      changes.push(`-${key}`);
    } else if (JSON.stringify(valueA) !== JSON.stringify(valueB)) {
      changes.push(`${key}: ${formatValue(valueA)} -> ${formatValue(valueB)}`);
    }
  }

  return changes.length > 0 ? changes.join(", ") : null;
}

/**
 * Format a value for display in diff output.
 */
function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 20 ? `"${value.slice(0, 20)}..."` : `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    return "{...}";
  }
  return String(value);
}
