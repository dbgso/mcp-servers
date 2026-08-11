import type { DependencyGraphResult, QueryGraphPreset } from "../../types/index.js";

/**
 * Context provided to query preset handlers.
 */
export interface QueryPresetContext {
  /** Dependency graph data to analyze */
  data: DependencyGraphResult;
}

/**
 * Result of a query preset execution.
 */
export interface QueryPresetResult {
  /** The preset name */
  preset: QueryGraphPreset;
  /** The jq query string used */
  jqQuery: string;
  /** Query result */
  result: unknown;
}

/**
 * Interface for query preset handlers.
 * Each handler implements a specific analysis strategy.
 */
export interface QueryPresetHandler {
  /** The preset name this handler handles */
  readonly preset: QueryGraphPreset;

  /** Returns the jq query string for this preset */
  getQuery(): string;

  /** Execute the preset analysis */
  execute(context: QueryPresetContext): QueryPresetResult;
}
