import { z } from "zod";

/**
 * Configuration for a document type
 */
export const TypeConfigSchema = z.object({
  /** Required parent type(s). null means root type, string means single type, array means any of */
  requires: z.union([
    z.null(),
    z.string(),
    z.array(z.string()),
  ]),
  /** Optional description for this type */
  description: z.string().optional(),
  /**
   * The child type that realizes a document of this type. A document with no
   * child of this type is reported as unrealized: a requirement nobody specified,
   * a design nobody implemented.
   */
  realizedBy: z.string().optional(),
  /** Documents of this type point at source code, and code drift is tracked for them */
  bindsCode: z.boolean().optional(),
});

export type TypeConfig = z.infer<typeof TypeConfigSchema>;

/**
 * Storage configuration
 */
export const StorageConfigSchema = z.object({
  /** Base path for document storage */
  basePath: z.string().default("./docs"),
  /** File extension */
  extension: z.string().default(".md"),
});

export type StorageConfig = z.infer<typeof StorageConfigSchema>;

/**
 * Chain configuration
 */
export const ChainConfigSchema = z.object({
  /** Document types and their dependencies */
  types: z.record(z.string(), TypeConfigSchema),
  /** Storage configuration */
  storage: StorageConfigSchema.optional().default({}),
  /** Directory that code paths are relative to (default: the working directory) */
  codeRoot: z.string().optional(),
});

export type ChainConfig = z.infer<typeof ChainConfigSchema>;

/**
 * What a child saw when it last agreed with one of its parents.
 * Either side changing afterwards makes the link suspect.
 */
export const LinkBaselineSchema = z.object({
  /** Content hash of the parent when the link was last confirmed */
  parent: z.string(),
  /** Content hash of the child itself when the link was last confirmed */
  self: z.string(),
  /** When the link was last confirmed */
  at: z.string().optional(),
});

export type LinkBaseline = z.infer<typeof LinkBaselineSchema>;

/**
 * A pointer from a document to source code: a file, a directory, or a glob,
 * relative to the code root, with the hash it had when last confirmed.
 */
export const CodeRefSchema = z.object({
  path: z.string(),
  hash: z.string().optional(),
  at: z.string().optional(),
});

export type CodeRef = z.infer<typeof CodeRefSchema>;

/**
 * Document frontmatter (stored in YAML)
 */
export const DocumentMetaSchema = z.object({
  /** Unique identifier (ULID) */
  id: z.string(),
  /** Document type */
  type: z.string(),
  /** Parent document ID(s) (required based on type config) */
  requires: z.union([z.string(), z.array(z.string())]).optional(),
  /** Document title */
  title: z.string(),
  /** Creation timestamp */
  created: z.string(),
  /** Last update timestamp */
  updated: z.string(),
  /** Per-parent record of the last confirmation, keyed by parent ID */
  baseline: z.record(z.string(), LinkBaselineSchema).optional(),
  /** Source code this document is realized by */
  code: z.array(CodeRefSchema).optional(),
});

export type DocumentMeta = z.infer<typeof DocumentMetaSchema>;

/**
 * Full document (meta + content)
 */
export interface Document extends DocumentMeta {
  /** Document body content (markdown) */
  content: string;
  /** File path */
  filePath: string;
}

/**
 * Document creation input
 */
export const CreateDocumentSchema = z.object({
  type: z.string().describe("Document type"),
  requires: z.union([z.string(), z.array(z.string())]).optional().describe("Parent document ID(s) (required based on type)"),
  title: z.string().describe("Document title"),
  content: z.string().describe("Document content (markdown)"),
});

export type CreateDocumentInput = z.infer<typeof CreateDocumentSchema>;

/**
 * Document update input
 */
export const UpdateDocumentSchema = z.object({
  id: z.string().describe("Document ID to update"),
  title: z.string().optional().describe("New title"),
  content: z.string().optional().describe("New content"),
});

export type UpdateDocumentInput = z.infer<typeof UpdateDocumentSchema>;

/**
 * Trace node for dependency tree
 */
export interface TraceNode {
  id: string;
  type: string;
  title: string;
  /** Whether this node has an unresolved finding of its own */
  suspect?: boolean;
  children: TraceNode[];
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  id: string;
  type: string;
  error: string;
}

/**
 * Kinds of problems `check` reports.
 *
 * Structural kinds say the chain is malformed. Drift kinds say something
 * changed after the last confirmation and a person has to decide whether the
 * other side still holds. Coverage kinds say a decision was never carried down.
 */
export type FindingKind =
  | "invalid_file"
  | "unknown_type"
  | "root_has_parent"
  | "missing_parent"
  | "parent_not_found"
  | "invalid_parent_type"
  | "cycle"
  | "unreviewed_link"
  | "parent_changed"
  | "self_changed"
  | "code_changed"
  | "code_missing"
  | "code_unreviewed"
  | "no_code"
  | "unrealized";

export type Severity = "error" | "warning";

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  /** The document the finding is about (file path for invalid_file) */
  id: string;
  type: string;
  title: string;
  message: string;
  /** The parent on the other side of the link, for link findings */
  parentId?: string;
  /** The code path, for code findings */
  path?: string;
}

export interface DocumentSummary {
  id: string;
  type: string;
  title: string;
}

/**
 * A suspect document together with everything above it that has to be
 * re-read before the suspicion can be cleared.
 */
export interface Escalation {
  document: DocumentSummary;
  /** Every ancestor up to the root(s), nearest first */
  ancestors: DocumentSummary[];
  /**
   * True when nothing above this document is unresolved, so it is the one to
   * work on now. Resolution goes top-down: the upper decision is settled first.
   */
  actionable: boolean;
}

export interface CheckReport {
  ok: boolean;
  errors: number;
  warnings: number;
  findings: Finding[];
  /** For each document with drift or a broken upward link, its ancestors to the root */
  escalations: Escalation[];
}

export interface ImpactReport {
  /** The documents the subject resolves to (the document itself, or the ones binding a code path) */
  subjects: DocumentSummary[];
  /** Everything above the subjects up to the roots: what a change has to be checked against */
  upstream: DocumentSummary[];
  /** Everything below the subjects: what a change can invalidate */
  downstream: DocumentSummary[];
}
