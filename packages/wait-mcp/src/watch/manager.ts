import { getErrorMessage } from "mcp-shared";
import {
  DEFAULT_MAX_BLOCK_MS,
  DEFAULT_MAX_WATCHES,
  DEFAULT_TIMEOUT_MS,
  MAX_CONSECUTIVE_ERRORS,
  MAX_EVENTS_PER_WATCH,
  MAX_MAX_BLOCK_MS,
  MAX_TIMEOUT_MS,
} from "../config.js";
import { defaultDeps } from "../deps/default.js";
import { getSource, allSources } from "../sources/registry.js";
import type { PollOutcome, SourceDeps, SourceState, WatchSource } from "../sources/types.js";
import { systemClock, type Clock } from "./clock.js";
import { nextSleepMs, remainingMs, resolveIntervalMs } from "./schedule.js";
import { WaitError, type Watch, type WatchSpec, type WatchStatus } from "./types.js";

export type JoinMode = "any" | "all";

export interface JoinResult {
  watches: Watch[];
  /** True when the call returned because it hit its block limit, not because the watches settled. */
  blocked: boolean;
}

export interface WatchManagerOptions {
  clock?: Clock;
  deps?: SourceDeps;
  maxWatches?: number;
  maxBlockMs?: number;
  maxConsecutiveErrors?: number;
}

interface WatchRecord {
  watch: Watch;
  source: WatchSource;
  config: unknown;
  state: SourceState;
  settled: Promise<void>;
  settle: () => void;
}

function clamp(params: { value: number; min: number; max: number }): number {
  return Math.min(Math.max(params.value, params.min), params.max);
}

function formatConfigIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
}

function appendEvents(params: { watch: Watch; events: string[] | undefined }): void {
  const { watch, events } = params;
  if (!events || events.length === 0) {
    return;
  }
  watch.events.push(...events);
  // Keep only the most recent events so a long-running watch stays small
  if (watch.events.length > MAX_EVENTS_PER_WATCH) {
    watch.events.splice(0, watch.events.length - MAX_EVENTS_PER_WATCH);
  }
}

/**
 * Owns every watch and its polling loop.
 *
 * A watch runs to completion whether or not anyone is blocked on it, so the
 * result is available from `get` even after a blocked call gave up waiting.
 */
export class WatchManager {
  private readonly records = new Map<string, WatchRecord>();
  private readonly clock: Clock;
  private readonly deps: SourceDeps;
  private readonly maxWatches: number;
  private readonly defaultMaxBlockMs: number;
  private readonly maxConsecutiveErrors: number;
  private counter = 0;

  constructor(options: WatchManagerOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.deps = options.deps ?? defaultDeps;
    this.maxWatches = options.maxWatches ?? DEFAULT_MAX_WATCHES;
    this.defaultMaxBlockMs = options.maxBlockMs ?? DEFAULT_MAX_BLOCK_MS;
    this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? MAX_CONSECUTIVE_ERRORS;
  }

  /** Create a watch and start polling it in the background. */
  create(spec: WatchSpec): Watch {
    const source = this.requireSource(spec.source);
    const parsed = source.configSchema.safeParse(spec.config ?? {});
    if (!parsed.success) {
      throw new WaitError(
        `Invalid config for source "${spec.source}":\n${formatConfigIssues(parsed.error as { issues: { path: PropertyKey[]; message: string }[] })}`,
      );
    }

    const active = this.list().filter((watch) => watch.status === "waiting").length;
    if (active >= this.maxWatches) {
      throw new WaitError(
        `Too many active watches (${this.maxWatches}). Cancel one with operation "cancel" before starting another.`,
      );
    }

    this.counter += 1;
    const watch: Watch = {
      id: `w_${this.counter}`,
      source: source.id,
      label: spec.label,
      status: "waiting",
      summary: "waiting for the first poll",
      events: [],
      polls: 0,
      createdAt: this.clock.now(),
      intervalMs: resolveIntervalMs({ requested: spec.intervalMs, source }),
      timeoutMs: clamp({ value: spec.timeoutMs ?? DEFAULT_TIMEOUT_MS, min: 1, max: MAX_TIMEOUT_MS }),
      consecutiveErrors: 0,
    };

    let settle = (): void => {};
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const record: WatchRecord = {
      watch,
      source,
      config: parsed.data,
      state: undefined,
      settled,
      settle,
    };
    this.records.set(watch.id, record);

    void this.runLoop(record).catch((error) => {
      this.finish({ record, status: "failed", summary: getErrorMessage(error) });
    });

    return watch;
  }

  /** Block until the given watches settle, or until the block limit is reached. */
  async join(params: { ids: string[]; mode?: JoinMode; maxBlockMs?: number }): Promise<JoinResult> {
    const records = params.ids.map((id) => this.requireRecord(id));
    const limit = clamp({
      value: params.maxBlockMs ?? this.defaultMaxBlockMs,
      min: 1,
      max: MAX_MAX_BLOCK_MS,
    });
    const pending = records.map((record) => record.settled);
    const settled = params.mode === "any" ? Promise.race(pending) : Promise.all(pending);

    const outcome = await Promise.race([
      settled.then(() => "settled" as const),
      this.clock.sleep(limit).then(() => "blocked" as const),
    ]);

    return { watches: records.map((record) => record.watch), blocked: outcome === "blocked" };
  }

  /** Create a watch and block on it in one call. */
  async until(params: { spec: WatchSpec; maxBlockMs?: number }): Promise<JoinResult> {
    const watch = this.create(params.spec);
    return this.join({ ids: [watch.id], mode: "all", maxBlockMs: params.maxBlockMs });
  }

  /** Evaluate a source once without creating a watch. */
  async checkOnce(params: { source: string; config: unknown }): Promise<PollOutcome> {
    const source = this.requireSource(params.source);
    const parsed = source.configSchema.safeParse(params.config ?? {});
    if (!parsed.success) {
      throw new WaitError(
        `Invalid config for source "${params.source}":\n${formatConfigIssues(parsed.error as { issues: { path: PropertyKey[]; message: string }[] })}`,
      );
    }
    return source.poll({ config: parsed.data, state: undefined, deps: this.deps });
  }

  cancel(id: string): Watch {
    const record = this.requireRecord(id);
    this.finish({ record, status: "cancelled", summary: "cancelled by request" });
    return record.watch;
  }

  cancelAll(): Watch[] {
    const cancelled: Watch[] = [];
    for (const record of this.records.values()) {
      if (record.watch.status !== "waiting") continue;
      this.finish({ record, status: "cancelled", summary: "cancelled by request" });
      cancelled.push(record.watch);
    }
    return cancelled;
  }

  list(): Watch[] {
    return [...this.records.values()].map((record) => record.watch);
  }

  get(id: string): Watch | undefined {
    return this.records.get(id)?.watch;
  }

  /** Current time as seen by this manager's clock. */
  now(): number {
    return this.clock.now();
  }

  requireWatch(id: string): Watch {
    return this.requireRecord(id).watch;
  }

  private requireSource(id: string): WatchSource {
    const source = getSource(id);
    if (!source) {
      const available = allSources.map((entry) => entry.id).join(", ");
      throw new WaitError(`Unknown source: "${id}". Available: ${available}`);
    }
    return source;
  }

  private requireRecord(id: string): WatchRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new WaitError(`Unknown watch id: "${id}". Use operation "status" to list watches.`);
    }
    return record;
  }

  private async runLoop(record: WatchRecord): Promise<void> {
    while (record.watch.status === "waiting") {
      await this.pollOnce(record);
      if (record.watch.status !== "waiting") return;

      const remaining = remainingMs({
        startedAt: record.watch.createdAt,
        timeoutMs: record.watch.timeoutMs,
        now: this.clock.now(),
      });
      if (remaining <= 0) {
        this.finish({
          record,
          status: "timeout",
          summary: `timed out after ${record.watch.timeoutMs}ms: ${record.watch.summary}`,
        });
        return;
      }

      await this.clock.sleep(
        nextSleepMs({
          baseIntervalMs: record.watch.intervalMs,
          consecutiveErrors: record.watch.consecutiveErrors,
          remainingMs: remaining,
        }),
      );
    }
  }

  private async pollOnce(record: WatchRecord): Promise<void> {
    record.watch.polls += 1;
    try {
      const outcome = await record.source.poll({
        config: record.config,
        state: record.state,
        deps: this.deps,
      });
      this.applyOutcome({ record, outcome });
    } catch (error) {
      this.applyError({ record, message: getErrorMessage(error) });
    }
  }

  private applyOutcome(params: { record: WatchRecord; outcome: PollOutcome }): void {
    const { record, outcome } = params;
    record.watch.consecutiveErrors = 0;
    record.watch.lastError = undefined;
    record.state = outcome.state ?? record.state;
    record.watch.summary = outcome.summary;
    record.watch.details = outcome.details;
    appendEvents({ watch: record.watch, events: outcome.events });

    if (outcome.satisfied) {
      this.finish({ record, status: "satisfied", summary: outcome.summary });
    }
  }

  private applyError(params: { record: WatchRecord; message: string }): void {
    const { record, message } = params;
    record.watch.consecutiveErrors += 1;
    record.watch.lastError = message;
    appendEvents({ watch: record.watch, events: [`poll error: ${message}`] });

    if (record.watch.consecutiveErrors >= this.maxConsecutiveErrors) {
      this.finish({
        record,
        status: "failed",
        summary: `polling failed ${record.watch.consecutiveErrors} times in a row: ${message}`,
      });
    }
  }

  private finish(params: { record: WatchRecord; status: WatchStatus; summary: string }): void {
    const { record, status, summary } = params;
    // A settled watch keeps its first outcome
    if (record.watch.status !== "waiting") {
      return;
    }
    record.watch.status = status;
    record.watch.summary = summary;
    record.watch.finishedAt = this.clock.now();
    record.settle();
  }
}
