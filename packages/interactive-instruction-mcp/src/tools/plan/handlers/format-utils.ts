import type { Task, TaskSummary } from "../../../types/index.js";

/**
 * Format options for parallel info display.
 */
interface FormatParallelOptions {
  /** Format style: "tag" for [parallel: A, B], "info" for yes (units: A, B) */
  style: "tag" | "info";
}

/**
 * Format parallelizable information for task display.
 * Shared utility to avoid duplication between handlers.
 */
export function formatParallel(
{ task, options }: { task: TaskSummary | Task; options: FormatParallelOptions; }): string {
  if (!task.is_parallelizable) {
    if (options.style === "info") {
      return "no";
    }
    return "";
  }

  const hasUnits = task.parallelizable_units && task.parallelizable_units.length > 0;

  if (options.style === "info") {
    if (hasUnits) {
      return `yes (units: ${task.parallelizable_units!.join(", ")})`;
    }
    return "yes";
  }

  // style === "tag"
  if (hasUnits) {
    return ` [parallel: ${task.parallelizable_units!.join(", ")}]`;
  }
  return " [parallel]";
}
