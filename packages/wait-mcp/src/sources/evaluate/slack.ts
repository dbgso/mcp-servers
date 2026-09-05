export interface SlackMessage {
  ts: string;
  user?: string;
  text?: string;
}

/** Slack timestamps are strings but order numerically, not lexicographically. */
function toNumber(ts: string | undefined): number {
  const value = Number(ts);
  if (Number.isNaN(value)) {
    return 0;
  }
  return value;
}

/** Newest timestamp in the batch; undefined for an empty batch. */
export function latestTs(messages: SlackMessage[]): string | undefined {
  let newest: SlackMessage | undefined;
  for (const message of messages) {
    if (!newest || toNumber(message.ts) > toNumber(newest.ts)) {
      newest = message;
    }
  }
  return newest?.ts;
}

/** Messages posted after the baseline that match the author/text filters. */
export function selectNewMessages(params: {
  messages: SlackMessage[];
  baselineTs: string | undefined;
  match?: string;
  from?: string;
}): SlackMessage[] {
  // Without a baseline nothing counts as new; the first poll only records one
  if (params.baselineTs === undefined) {
    return [];
  }
  const baseline = toNumber(params.baselineTs);

  return params.messages.filter((message) => {
    if (toNumber(message.ts) <= baseline) return false;
    if (params.from !== undefined && message.user !== params.from) return false;
    if (params.match !== undefined && !new RegExp(params.match).test(message.text ?? "")) return false;
    return true;
  });
}

/** One-line rendering of a reply for the event log. */
export function describeMessage(message: SlackMessage): string {
  return `reply from ${message.user ?? "unknown"}: ${(message.text ?? "").slice(0, 120)}`;
}
