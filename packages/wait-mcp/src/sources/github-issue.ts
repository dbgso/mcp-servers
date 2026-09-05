import { z } from "zod";
import {
  buildIssueBaseline,
  evaluateIssue,
  type IssueBaseline,
  type IssueComment,
  type IssueSnapshot,
  type IssueUntil,
} from "./evaluate/issue.js";
import { repoSlug, runGhJson } from "./gh.js";
import type { PollOutcome, WatchSource } from "./types.js";

const configSchema = z.object({
  repo: z.string().optional().describe("owner/name (default: repository of cwd)"),
  number: z.number().int().positive().describe("Issue or PR number"),
  until: z
    .enum(["new_comment", "closed", "state_change", "label"])
    .optional()
    .describe("Condition to wait for (default: new_comment)"),
  label: z.string().optional().describe("Required when until=label"),
  from: z.string().optional().describe("Only count comments from this login"),
  cwd: z.string().optional().describe("Directory to run gh in"),
});

type Config = z.infer<typeof configSchema>;

interface IssueState extends Record<string, unknown> {
  baseline: IssueBaseline;
}

/** Read the watched fields out of the issues API payload. */
export function parseIssue(payload: unknown): IssueSnapshot {
  const record = payload as { state?: unknown; title?: unknown; labels?: unknown[] } | null;
  const labels = Array.isArray(record?.labels) ? record.labels : [];
  return {
    state: String(record?.state ?? "open"),
    title: String(record?.title ?? ""),
    labels: labels.map((label) => String((label as { name?: unknown })?.name ?? label)),
  };
}

/** Read the comment list out of the issue comments API payload. */
export function parseComments(payload: unknown): IssueComment[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.map((comment) => {
    const record = comment as { id?: unknown; user?: { login?: unknown }; body?: unknown };
    return {
      id: Number(record.id ?? 0),
      login: String(record.user?.login ?? "unknown"),
      body: String(record.body ?? ""),
    };
  });
}

export const githubIssueSource: WatchSource<Config> = {
  id: "github_issue",
  summary: "Wait for an update on a GitHub issue or pull request",
  detail: `Polls \`gh api repos/{owner}/{repo}/issues/<number>\` and its comments.

The state at the first poll becomes the baseline, so \`new_comment\` and \`state_change\` only
report what happened after the watch started. \`closed\` and \`label\` are absolute conditions and
can be satisfied on the first poll.

Examples:
  params: { config: { number: 34, until: "new_comment", from: "dbgso" } }
  params: { config: { repo: "dbgso/mcp-servers", number: 20, until: "closed" } }`,
  category: "GitHub",
  defaultIntervalMs: 30_000,
  minIntervalMs: 10_000,
  configSchema,
  async poll({ config, state, deps }): Promise<PollOutcome> {
    const until: IssueUntil = config.until ?? "new_comment";
    // The label condition is meaningless without the label to look for
    if (until === "label" && config.label === undefined) {
      throw new Error('config.label is required when until="label"');
    }

    const slug = repoSlug(config.repo);
    const issue = parseIssue(
      await runGhJson({ deps, args: ["api", `repos/${slug}/issues/${config.number}`], cwd: config.cwd }),
    );
    const comments = parseComments(
      await runGhJson({
        deps,
        args: ["api", `repos/${slug}/issues/${config.number}/comments?per_page=100`],
        cwd: config.cwd,
      }),
    );

    const baseline =
      (state as IssueState | undefined)?.baseline ?? buildIssueBaseline({ issue, comments });
    const evaluation = evaluateIssue({
      issue,
      comments,
      baseline,
      config: { until, label: config.label, from: config.from },
    });

    return {
      satisfied: evaluation.satisfied,
      summary: `#${config.number} ${evaluation.summary}`,
      state: { baseline },
      details: { title: issue.title, ...(evaluation.details as Record<string, unknown>) },
      events: evaluation.events,
    };
  },
};
