/** Upper bound for the error backoff, so a broken watch still retries every 5 minutes. */
export const MAX_BACKOFF_MS = 300_000;

/** Resolve the polling interval from the request and the source's own limits. */
export function resolveIntervalMs(params: {
  requested: number | undefined;
  source: { defaultIntervalMs: number; minIntervalMs: number };
}): number {
  if (params.requested === undefined) {
    return params.source.defaultIntervalMs;
  }
  return Math.max(params.requested, params.source.minIntervalMs);
}

/** Interval for the next poll: exponential backoff while consecutive errors last. */
export function nextIntervalMs(params: { baseMs: number; consecutiveErrors: number }): number {
  if (params.consecutiveErrors <= 0) {
    return params.baseMs;
  }
  const backoff = params.baseMs * 2 ** params.consecutiveErrors;
  return Math.min(backoff, MAX_BACKOFF_MS);
}

/** Milliseconds left before the watch deadline; 0 once it has passed. */
export function remainingMs(params: {
  startedAt: number;
  timeoutMs: number;
  now: number;
}): number {
  const left = params.startedAt + params.timeoutMs - params.now;
  return Math.max(left, 0);
}

/** How long to sleep before the next poll, never sleeping past the deadline. */
export function nextSleepMs(params: {
  baseIntervalMs: number;
  consecutiveErrors: number;
  remainingMs: number;
}): number {
  return Math.min(
    nextIntervalMs({ baseMs: params.baseIntervalMs, consecutiveErrors: params.consecutiveErrors }),
    params.remainingMs,
  );
}
