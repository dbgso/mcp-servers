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
});

export type ChainConfig = z.infer<typeof ChainConfigSchema>;

/**
 * Document frontmatter (stored in YAML)
 */
export const DocumentMetaSchema = z.object({
  /** Unique identifier (ULID) */
  id: z.string(),
  /** Document type */
  type: z.string(),
  /** Parent document ID (required based on type config) */
  requires: z.string().optional(),
  /** Document title */
  title: z.string(),
  /** Creation timestamp */
  created: z.string(),
  /** Last update timestamp */
  updated: z.string(),
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
  requires: z.string().optional().describe("Parent document ID (required based on type)"),
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
