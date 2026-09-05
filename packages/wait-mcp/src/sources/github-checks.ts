import { z } from "zod";
import { evaluateCheckRuns, type CheckRequirement, type CheckRun } from "./evaluate/check-runs.js";
import { repoSlug, runGh, runGhJson } from "./gh.js";
import type { PollOutcome, SourceDeps, SourceState, WatchSource } from "./types.js";

const configSchema = z.object({
  repo: z.string().optional().describe("owner/name (default: repository of cwd)"),
  ref: z.string().optional().describe("Branch name or SHA (default: current branch)"),
  pr: z.number().int().positive().optional().describe("PR number; its head SHA is watched"),
  require: z
    .enum(["complete", "success"])
    .optional()
    .describe("complete (default): wait for every check to finish. success: stop as soon as a failure is certain"),
  cwd: z.string().optional().describe("Directory to run gh/git in"),
});

type Config = z.infer<typeof configSchema>;

interface ChecksState extends Record<string, unknown> {
  ref: string;
  failed: string[];
}

/** Read check runs out of the `check-runs` API payload. */
export function parseCheckRuns(payload: unknown): CheckRun[] {
  const runs = (payload as { check_runs?: unknown[] } | null)?.check_runs;
  if (!Array.isArray(runs)) {
    return [];
  }
  return runs.map((run) => {
    const record = run as { name?: unknown; status?: unknown; conclusion?: unknown };
    return {
      name: String(record.name ?? "unnamed"),
      status: String(record.status ?? "queued"),
      conclusion: record.conclusion === null || record.conclusion === undefined ? null : String(record.conclusion),
    };
  });
}

/** Resolve the commit-ish whose checks are watched, once per watch. */
async function resolveRef(params: {
  config: Config;
  state: SourceState;
  deps: SourceDeps;
}): Promise<string> {
  const cached = (params.state as ChecksState | undefined)?.ref;
  if (cached) {
    return cached;
  }

  if (params.config.pr !== undefined) {
    const sha = await runGh({
      deps: params.deps,
      args: ["api", `repos/${repoSlug(params.config.repo)}/pulls/${params.config.pr}`, "--jq", ".head.sha"],
      cwd: params.config.cwd,
    });
    return sha.trim();
  }

  if (params.config.ref !== undefined) {
    return params.config.ref;
  }

  const branch = await params.deps.runCommand({
    command: "git",
    args: ["rev-parse", "--abbrev-ref", "HEAD"],
    cwd: params.config.cwd,
  });
  if (branch.exitCode !== 0) {
    throw new Error(`could not resolve current branch: ${branch.stderr.trim()}`);
  }
  return branch.stdout.trim();
}

export const githubChecksSource: WatchSource<Config> = {
  id: "github_checks",
  summary: "Wait for GitHub check runs (CI) on a commit to finish",
  detail: `Polls \`gh api repos/{owner}/{repo}/commits/<ref>/check-runs\` until the checks reach a terminal state.

Terminal means every check is completed. With \`require: "success"\` a confirmed failure is terminal too,
because the outcome can no longer change. \`details.outcome\` is success / failure / pending.

Examples:
  params: { config: { pr: 42, require: "success" } }
  params: { config: { repo: "dbgso/mcp-servers", ref: "main" } }`,
  category: "CI",
  defaultIntervalMs: 20_000,
  minIntervalMs: 5_000,
  configSchema,
  async poll({ config, state, deps }): Promise<PollOutcome> {
    const ref = await resolveRef({ config, state, deps });
    const payload = await runGhJson({
      deps,
      args: ["api", `repos/${repoSlug(config.repo)}/commits/${ref}/check-runs?per_page=100`],
      cwd: config.cwd,
    });
    const runs = parseCheckRuns(payload);
    const requirement: CheckRequirement = config.require ?? "complete";
    const evaluation = evaluateCheckRuns({ runs, requirement });

    const knownFailures = (state as ChecksState | undefined)?.failed ?? [];
    const newFailures = evaluation.failed.filter((name) => !knownFailures.includes(name));

    return {
      satisfied: evaluation.satisfied,
      summary: evaluation.summary,
      state: { ref, failed: evaluation.failed },
      details: {
        ref,
        outcome: evaluation.outcome,
        total: evaluation.total,
        completed: evaluation.completed,
        failed: evaluation.failed,
        checks: runs,
      },
      events: newFailures.map((name) => `${name} failed`),
    };
  },
};
