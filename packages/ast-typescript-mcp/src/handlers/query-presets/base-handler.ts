import { execSync } from "node:child_process";
import type { QueryGraphPreset } from "../../types/index.js";
import type { QueryPresetHandler, QueryPresetContext, QueryPresetResult } from "./types.js";

/**
 * Abstract base class for query preset handlers.
 * Provides common jq execution logic.
 */
export abstract class BaseQueryPresetHandler implements QueryPresetHandler {
  abstract readonly preset: QueryGraphPreset;
  abstract getQuery(): string;

  execute(context: QueryPresetContext): QueryPresetResult {
    const jqQuery = this.getQuery();
    const result = this.runJqQuery(context.data, jqQuery);
    return {
      preset: this.preset,
      jqQuery,
      result,
    };
  }

  /**
   * Execute jq query on data.
   */
  protected runJqQuery(data: unknown, query: string): unknown {
    const input = JSON.stringify(data);
    const cleanQuery = query.replace(/\n/g, " ").trim();

    try {
      const result = execSync(`echo '${input.replace(/'/g, "'\\''")}' | jq '${cleanQuery}'`, {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024, // 50MB
      });
      return JSON.parse(result);
    } catch (error) {
      throw new Error(`jq query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
