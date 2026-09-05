export type WatchStatus = "waiting" | "satisfied" | "timeout" | "failed" | "cancelled";

export interface WatchSpec {
  source: string;
  config: unknown;
  intervalMs?: number;
  timeoutMs?: number;
  label?: string;
}

export interface Watch {
  id: string;
  source: string;
  label?: string;
  status: WatchStatus;
  summary: string;
  details?: unknown;
  events: string[];
  polls: number;
  createdAt: number;
  finishedAt?: number;
  intervalMs: number;
  timeoutMs: number;
  consecutiveErrors: number;
  lastError?: string;
}

/** Error carrying a message meant for the caller rather than a stack trace. */
export class WaitError extends Error {}
