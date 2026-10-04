import type { TaskStatus, TaskSummary } from "../types/index.js";
import { STATUS_STYLE, statusLookup } from "./task-presentation.js";

/**
 * The task graph, drawn once for GRAPH.md and `plan(action: "graph")`.
 *
 * Each view used to build its own flowchart and they had drifted: only GRAPH.md
 * escaped quotes in titles and drew parent links, only the tool showed a task
 * waiting on its dependencies as blocked, and the two used different icons for
 * the same status.
 */

const STATUS_ICON: Record<TaskStatus, string> = {
  completed: "✓",
  self_review: "◐",
  pending_review: "⏳",
  in_progress: "●",
  blocked: "◇",
  skipped: "⊘",
  pending: "○",
};

const LEGEND = [
  "- ✓ completed",
  "- ◐ self_review",
  "- ⏳ pending_review",
  "- ● in_progress",
  "- ○ pending/ready",
  "- ◇ blocked",
  "- ⊘ skipped",
  "- `[ ]` sequential",
  "- `([ ])` parallelizable",
  "- `-->` dependency",
  "- `-.->` parent-child",
];

/** Mermaid IDs can't have hyphens in some contexts. */
function nodeId(id: string): string {
  return id.replace(/-/g, "_");
}

function nodeLine(params: { task: TaskSummary; status: string }): string {
  const { task, status } = params;
  const label = `"${task.title.replace(/"/g, '\\"')} ${statusLookup({ table: STATUS_ICON, status })}"`;
  const shape = task.is_parallelizable ? `([${label}])` : `[${label}]`;
  return `  ${nodeId(task.id)}${shape}`;
}

function edgeLines(task: TaskSummary): string[] {
  const id = nodeId(task.id);
  const dependencies = task.dependencies.map((dep) => `  ${nodeId(dep)} --> ${id}`);
  const parent = task.parent ? [`  ${nodeId(task.parent)} -.-> ${id}`] : [];
  return [...dependencies, ...parent];
}

/**
 * The graph as markdown: a mermaid flowchart and its legend. `blockedIds` are
 * tasks waiting on dependencies, drawn as blocked whatever their stored status.
 */
export function renderTaskGraph(params: { tasks: TaskSummary[]; blockedIds: ReadonlySet<string> }): string {
  const { tasks, blockedIds } = params;
  const shownStatus = (task: TaskSummary): string => (blockedIds.has(task.id) ? "blocked" : task.status);

  return [
    "# Task Graph",
    "",
    "```mermaid",
    "flowchart TD",
    ...tasks.map((task) => nodeLine({ task, status: shownStatus(task) })),
    "",
    ...tasks.flatMap(edgeLines),
    "",
    "  %% Styling",
    ...tasks.map((task) => `  style ${nodeId(task.id)} ${statusLookup({ table: STATUS_STYLE, status: shownStatus(task) })}`),
    "```",
    "",
    "## Legend",
    ...LEGEND,
  ].join("\n");
}
