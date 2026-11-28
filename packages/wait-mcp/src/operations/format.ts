import type { JoinResult } from "../watch/manager.js";
import type { Watch } from "../watch/types.js";

/** How the caller resumes waiting after a call returned on its block limit. */
export function nextJoinHint(ids: string[]): string {
  return `execute({ operation: "join", params: { ids: ${JSON.stringify(ids)} } })`;
}

export function formatWatch(params: {
  watch: Watch;
  now: number;
  includeEvents?: boolean;
  includeDetails?: boolean;
}): Record<string, unknown> {
  const { watch } = params;
  const formatted: Record<string, unknown> = {
    id: watch.id,
    source: watch.source,
    status: watch.status,
    summary: watch.summary,
    polls: watch.polls,
    elapsed_ms: (watch.finishedAt ?? params.now) - watch.createdAt,
  };

  if (watch.label !== undefined) formatted.label = watch.label;
  if (params.includeDetails && watch.details !== undefined) formatted.details = watch.details;
  if (params.includeEvents && watch.events.length > 0) formatted.events = [...watch.events];
  if (watch.lastError !== undefined) formatted.last_error = watch.lastError;
  if (watch.status === "waiting") formatted.next = nextJoinHint([watch.id]);

  return formatted;
}

/** Response body for until/join: a single watch stays flat, several are wrapped. */
export function formatJoinResult(params: { result: JoinResult; now: number }): unknown {
  const watches = params.result.watches.map((watch) =>
    formatWatch({ watch, now: params.now, includeEvents: true, includeDetails: true }),
  );

  if (watches.length === 1) {
    return watches[0];
  }
  return {
    blocked: params.result.blocked,
    watches,
    next: nextJoinHint(params.result.watches.map((watch) => watch.id)),
  };
}
