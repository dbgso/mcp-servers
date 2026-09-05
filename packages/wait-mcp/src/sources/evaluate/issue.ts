export type IssueUntil = "new_comment" | "closed" | "state_change" | "label";

export interface IssueSnapshot {
  state: string;
  title: string;
  labels: string[];
}

export interface IssueComment {
  id: number;
  login: string;
  body: string;
}

export interface IssueBaseline {
  state: string;
  labels: string[];
  lastCommentId: number;
}

export interface IssueConfig {
  until: IssueUntil;
  label?: string;
  from?: string;
}

export interface IssueEvaluation {
  satisfied: boolean;
  summary: string;
  details: unknown;
  events: string[];
}

interface ConditionInput {
  issue: IssueSnapshot;
  comments: IssueComment[];
  baseline: IssueBaseline;
  config: IssueConfig;
}

/** Highest comment id seen so far; 0 when the issue has no comments. */
export function latestCommentId(comments: IssueComment[]): number {
  return comments.reduce((max, comment) => Math.max(max, comment.id), 0);
}

/** Snapshot the issue as it looked when the watch started. */
export function buildIssueBaseline(params: {
  issue: IssueSnapshot;
  comments: IssueComment[];
}): IssueBaseline {
  return {
    state: params.issue.state,
    labels: [...params.issue.labels],
    lastCommentId: latestCommentId(params.comments),
  };
}

/** Comments posted after the baseline, optionally narrowed to one author. */
export function selectNewComments(input: ConditionInput): IssueComment[] {
  return input.comments.filter((comment) => {
    if (comment.id <= input.baseline.lastCommentId) return false;
    if (input.config.from === undefined) return true;
    return comment.login === input.config.from;
  });
}

function evaluateNewComment(input: ConditionInput): IssueEvaluation {
  const fresh = selectNewComments(input);
  const author = input.config.from ? ` from ${input.config.from}` : "";
  return {
    satisfied: fresh.length > 0,
    summary:
      fresh.length > 0
        ? `${fresh.length} new comment(s)${author}`
        : `no new comment${author} yet (state: ${input.issue.state})`,
    details: { state: input.issue.state, new_comments: fresh },
    events: fresh.map((comment) => `comment by ${comment.login}: ${comment.body.slice(0, 120)}`),
  };
}

function evaluateClosed(input: ConditionInput): IssueEvaluation {
  const satisfied = input.issue.state === "closed";
  return {
    satisfied,
    summary: `state: ${input.issue.state}`,
    details: { state: input.issue.state },
    events: satisfied ? ["issue closed"] : [],
  };
}

function evaluateStateChange(input: ConditionInput): IssueEvaluation {
  const satisfied = input.issue.state !== input.baseline.state;
  return {
    satisfied,
    summary: satisfied
      ? `state changed: ${input.baseline.state} -> ${input.issue.state}`
      : `state unchanged: ${input.issue.state}`,
    details: { state: input.issue.state, baseline_state: input.baseline.state },
    events: satisfied ? [`state -> ${input.issue.state}`] : [],
  };
}

function evaluateLabel(input: ConditionInput): IssueEvaluation {
  const wanted = input.config.label ?? "";
  const satisfied = input.issue.labels.includes(wanted);
  return {
    satisfied,
    summary: satisfied ? `label "${wanted}" applied` : `label "${wanted}" not applied yet`,
    details: { labels: input.issue.labels },
    events: satisfied ? [`label ${wanted}`] : [],
  };
}

const CONDITIONS: Record<IssueUntil, (input: ConditionInput) => IssueEvaluation> = {
  new_comment: evaluateNewComment,
  closed: evaluateClosed,
  state_change: evaluateStateChange,
  label: evaluateLabel,
};

/** Evaluate the issue against the watch condition, relative to the baseline. */
export function evaluateIssue(input: ConditionInput): IssueEvaluation {
  return CONDITIONS[input.config.until](input);
}
