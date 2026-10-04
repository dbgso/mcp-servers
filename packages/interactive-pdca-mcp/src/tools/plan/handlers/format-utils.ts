import type { Task, TaskSummary } from "../../../types/index.js";

type ParallelStyle = "tag" | "info";

/**
 * Format options for parallel info display.
 */
interface FormatParallelOptions {
  /** Format style: "tag" for [parallel: A, B], "info" for yes (units: A, B) */
  style: ParallelStyle;
}

/** How each style spells the three cases: not parallel, parallel, parallel with named units. */
const PARALLEL_FORMATS: Record<
  ParallelStyle,
  { no: string; yes: string; withUnits: (units: string) => string }
> = {
  info: { no: "no", yes: "yes", withUnits: (units) => `yes (units: ${units})` },
  tag: { no: "", yes: " [parallel]", withUnits: (units) => ` [parallel: ${units}]` },
};

/**
 * Format parallelizable information for task display.
 * Shared utility to avoid duplication between handlers.
 */
export function formatParallel(
{ task, options }: { task: TaskSummary | Task; options: FormatParallelOptions; }): string {
  const format = PARALLEL_FORMATS[options.style];
  if (!task.is_parallelizable) {
    return format.no;
  }
  const units = task.parallelizable_units ?? [];
  return units.length > 0 ? format.withUnits(units.join(", ")) : format.yes;
}
