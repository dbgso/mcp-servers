import type { QueryGraphPreset } from "../../types/index.js";
import type { QueryPresetHandler } from "./types.js";
import { TopReferencedHandler } from "./top-referenced-handler.js";
import { TopImportersHandler } from "./top-importers-handler.js";
import { OrphansHandler } from "./orphans-handler.js";
import { CouplingHandler } from "./coupling-handler.js";
import { ModulesHandler } from "./modules-handler.js";

/**
 * Registry of query preset handlers.
 * Maps preset names to their handler instances.
 */
export class QueryPresetRegistry {
  private handlers: Map<QueryGraphPreset, QueryPresetHandler>;

  constructor() {
    this.handlers = new Map();
    this.registerHandler(new TopReferencedHandler());
    this.registerHandler(new TopImportersHandler());
    this.registerHandler(new OrphansHandler());
    this.registerHandler(new CouplingHandler());
    this.registerHandler(new ModulesHandler());
  }

  /**
   * Register a handler for a preset.
   */
  registerHandler(handler: QueryPresetHandler): void {
    this.handlers.set(handler.preset, handler);
  }

  /**
   * Get handler for a preset.
   */
  getHandler(preset: QueryGraphPreset): QueryPresetHandler | undefined {
    return this.handlers.get(preset);
  }

  /**
   * Check if a preset is supported.
   */
  hasPreset(preset: QueryGraphPreset): boolean {
    return this.handlers.has(preset);
  }

  /**
   * Get all supported preset names.
   */
  getPresetNames(): QueryGraphPreset[] {
    return Array.from(this.handlers.keys());
  }
}

// Singleton instance
let registry: QueryPresetRegistry | null = null;

/**
 * Get the singleton registry instance.
 */
export function getQueryPresetRegistry(): QueryPresetRegistry {
  if (!registry) {
    registry = new QueryPresetRegistry();
  }
  return registry;
}
