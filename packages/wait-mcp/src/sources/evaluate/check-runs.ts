export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

export type CheckRequirement = "complete" | "success";

export type CheckOutcome = "success" | "failure" | "pending";

export interface CheckEvaluation {
  satisfied: boolean;
  outcome: CheckOutcome;
  total: number;
  completed: number;
  failed: string[];
  summary: string;
}

/** Conclusions that mean "this check will not turn green on its own". */
const FAILURE_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
  "stale",
]);

function isCompleted(run: CheckRun): boolean {
  return run.status === "completed";
}

function isFailed(run: CheckRun): boolean {
  return isCompleted(run) && FAILURE_CONCLUSIONS.has(run.conclusion ?? "");
}

function resolveOutcome(params: {
  total: number;
  completed: number;
  hasFailure: boolean;
  requirement: CheckRequirement;
}): CheckOutcome {
  // No check has been registered yet, so nothing can be concluded
  if (params.total === 0) {
    return "pending";
  }
  if (params.completed === params.total) {
    if (params.hasFailure) return "failure";
    return "success";
  }
  // Waiting for the rest is pointless once success is required and one check already failed
  if (params.requirement === "success" && params.hasFailure) {
    return "failure";
  }
  return "pending";
}

function buildSummary(params: {
  completed: number;
  total: number;
  failed: string[];
}): string {
  const base = `${params.completed}/${params.total} checks completed`;
  if (params.failed.length === 0) {
    return base;
  }
  return `${base} (failure: ${params.failed.join(", ")})`;
}

/** Decide whether a commit's check runs have reached a terminal state. */
export function evaluateCheckRuns(params: {
  runs: CheckRun[];
  requirement: CheckRequirement;
}): CheckEvaluation {
  const { runs } = params;
  const completed = runs.filter(isCompleted).length;
  const failed = runs.filter(isFailed).map((run) => run.name);
  const outcome = resolveOutcome({
    total: runs.length,
    completed,
    hasFailure: failed.length > 0,
    requirement: params.requirement,
  });

  return {
    satisfied: outcome !== "pending",
    outcome,
    total: runs.length,
    completed,
    failed,
    summary: buildSummary({ completed, total: runs.length, failed }),
  };
}
