import { TASK_PHASES } from "../types/index.js";
import type { TaskOutput, TaskPhase, TaskStatus } from "../types/index.js";

/**
 * How tasks are shown, in one place for every view that shows them.
 *
 * `read_output` and PENDING_REVIEW.md each had their own copy of the phase
 * sections, and `read_output`'s matched phase names (research / implement /
 * verify) that nothing writes any more, so it never printed one. The graph
 * styles were copied the same way and had drifted. Each table below is keyed by
 * the full union, so a phase or status added to the type is a compile error
 * here until every view knows how to show it.
 */

export interface Section {
  heading: string;
  body: string;
}

const NOT_RECORDED = "(not recorded)";

export function formatChangesTable(changes: TaskOutput["changes"]): string {
  const header = "| File | Lines | Changes |\n|------|-------|---------|";
  if (!changes || changes.length === 0) {
    return `${header}\n| _(no changes recorded)_ | - | - |`;
  }
  const rows = changes.map((c) => `| \`${c.file}\` | ${c.lines} | ${c.description} |`);
  return `${header}\n${rows.join("\n")}`;
}

function formatSources(sources: TaskOutput["sources"]): string {
  return sources?.map((s) => `- ${s}`).join("\n") || "- (none)";
}

/** What one PDCA phase's output adds to the common what / why / how. */
interface PhaseReport {
  sections(output: TaskOutput): Section[];
}

class PlanReport implements PhaseReport {
  sections(output: TaskOutput): Section[] {
    return [
      { heading: "Findings", body: output.findings || NOT_RECORDED },
      { heading: "Sources", body: formatSources(output.sources) },
    ];
  }
}

class DoReport implements PhaseReport {
  sections(output: TaskOutput): Section[] {
    return [
      { heading: "Changes", body: formatChangesTable(output.changes) },
      { heading: "Design Decisions", body: output.design_decisions || NOT_RECORDED },
    ];
  }
}

class CheckReport implements PhaseReport {
  sections(output: TaskOutput): Section[] {
    return [
      { heading: "Test Target", body: output.test_target || NOT_RECORDED },
      { heading: "Test Results", body: output.test_results || NOT_RECORDED },
      { heading: "Coverage", body: output.coverage || NOT_RECORDED },
    ];
  }
}

class ActReport implements PhaseReport {
  sections(output: TaskOutput): Section[] {
    return [
      { heading: "Changes", body: formatChangesTable(output.changes) },
      { heading: "Feedback Addressed", body: output.feedback_addressed || NOT_RECORDED },
    ];
  }
}

const PHASE_REPORTS: Record<TaskPhase, PhaseReport> = {
  plan: new PlanReport(),
  do: new DoReport(),
  check: new CheckReport(),
  act: new ActReport(),
};

export function isTaskPhase(phase: string): phase is TaskPhase {
  return (TASK_PHASES as readonly string[]).includes(phase);
}

/**
 * The phase-specific sections of an output. A phase this version does not know
 * -- an output written before the PDCA names -- has none.
 */
export function phaseSections(output: TaskOutput): Section[] {
  return isTaskPhase(output.phase) ? PHASE_REPORTS[output.phase].sections(output) : [];
}

export function renderSections(params: { sections: Section[]; level: number }): string {
  const { sections, level } = params;
  const hashes = "#".repeat(level);
  return sections.map((s) => `${hashes} ${s.heading}\n${s.body}`).join("\n\n");
}

/** Mermaid `style` for a task node, shared by GRAPH.md and `plan(action: "graph")`. */
export const STATUS_STYLE: Record<TaskStatus, string> = {
  completed: "fill:#90EE90,stroke:#228B22",
  self_review: "fill:#FFD700,stroke:#B8860B", // Gold: the AI is reviewing its own work
  pending_review: "fill:#DDA0DD,stroke:#8B008B",
  in_progress: "fill:#87CEEB,stroke:#4682B4",
  blocked: "fill:#FFB6C1,stroke:#DC143C",
  skipped: "fill:#D3D3D3,stroke:#808080",
  pending: "fill:#FFFACD,stroke:#DAA520",
};

/** Lookup for a status read back from disk, which may be one this version does not know. */
export function statusLookup<T>(params: { table: Record<TaskStatus, T>; status: string }): T {
  const { table, status } = params;
  return Object.hasOwn(table, status) ? table[status as TaskStatus] : table.pending;
}

/**
 * The calls a reviewer makes on a pending_review task. Each view that offered
 * them spelled them itself, and two had drifted to calls that do not exist:
 * `approve(target: "task", id: …)` and `plan(action: "status", …)`.
 */
export function reviewCommands(id: string): { approve: string; requestChanges: string } {
  return {
    approve: `approve(target: "task", task_id: "${id}")`,
    requestChanges: `plan(action: "request_changes", id: "${id}", comment: "<feedback>")`,
  };
}

/** Items joined with commas, or "none" for an empty list. */
export function listOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join(", ") : "none";
}
