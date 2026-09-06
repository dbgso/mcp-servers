/**
 * Deliberation gate -- a speed bump in front of an operation, for changes that
 * warrant disclosure rather than consent.
 *
 * The first attempt is refused. The refusal tells the caller to explain the
 * change to the user in its own words and then repeat the identical call. Only
 * a run of identical attempts gets through, at which point whatever approval
 * flow the tool configured runs as usual -- often none, because this is meant
 * for operations that do not warrant a token. The run ends when the caller
 * reports the operation done, not when it passes the gate.
 *
 * ## What it buys, and what it does not
 *
 * It buys DISCLOSURE. A refused call forces the agent to produce user-facing
 * text, and the explanation it commits to is a parameter, so it lands in the
 * transcript where a human can see it and intervene. It costs no round trip:
 * nobody has to read a notification or relay a token, and it works in a
 * headless session where the token strategy cannot.
 *
 * It does not buy CONSENT. Nothing here verifies that a human read anything.
 * An agent may repeat the call without saying a word. Do not put an operation
 * behind this gate if an uncooperative or confused caller getting through would
 * matter -- use `TokenApprovalStrategy`, where the proof travels on a channel
 * the caller cannot read.
 *
 * ## Why repetition is a meaningful signal
 *
 * Not because a model rarely repeats itself -- given a refusal that says "call
 * again", repeating is exactly what it does. The signal is that the key
 * includes the caller's own `explanation`, and the reflex on being refused is
 * to retry with ALTERED arguments. Altered arguments are a different key, which
 * is refused again with the same instruction. Getting through requires
 * committing to one account of the change and standing by it verbatim, which is
 * a different act from retrying.
 *
 * ## What a run survives
 *
 * Runs are held per key, so an unrelated operation in between does not break
 * one. That is not a relaxation for its own sake: an agent asked to relate
 * several documents works on them together, and a store that kept only the
 * newest run would refuse the first document forever -- attempt one for A,
 * attempt one for B, attempt two for A, each landing on a slot the other just
 * took.
 *
 * What survives is narrow. `what` is part of the key, so a run applies only to
 * the exact change it was started for; re-stage a different change and the old
 * run does not carry over. Within that, the TTL is what bounds a run left
 * half-finished, which makes it load-bearing rather than a backstop.
 *
 * It is process memory, so a restart fails closed.
 */

import { contentHash } from "../content-hash.js";

/** Attempts required by default. Two is the documented, ordinary setting. */
export const DEFAULT_REQUIRED_ATTEMPTS = 2;

/**
 * How long a run may sit half-finished.
 *
 * With runs held per key, nothing else expires them, so this is what bounds a
 * run nobody came back to. It stays generous anyway: the whole point is that
 * the caller goes and talks to a human in between, and the window it leaves
 * open is narrow -- reaching a stale run means repeating the same operation,
 * over the same `what`, with the same explanation, having changed nothing.
 */
export const DEFAULT_DELIBERATION_TTL_MS = 10 * 60 * 1000;

export interface DeliberationConfig {
  /**
   * Consecutive identical attempts required to pass. Defaults to
   * `DEFAULT_REQUIRED_ATTEMPTS`. Raise it for an operation that deserves more
   * friction -- though an operation that deserves much more probably deserves
   * a different strategy instead.
   */
  requiredAttempts?: number;
  /** Overrides `DEFAULT_DELIBERATION_TTL_MS`. */
  ttlMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

export interface DeliberationRequest {
  /** Identifies the operation, e.g. `instruction::apply::<id>`. */
  operation: string;
  /**
   * Tool-computed ground truth of what will change -- the same value a
   * content-bound approval would be keyed on. Part of the key, so a caller that
   * re-stages a different change starts a new run.
   */
  what: string;
  /**
   * The caller's account of the change, in its own words, as it gave it to the
   * user. Part of the key: this is what makes a run mean something.
   */
  explanation: string;
}

/**
 * Identifies one run.
 *
 * Branded so it can only have come from `consider`. `settle` takes the key of
 * a run this gate actually issued, rather than any string a caller assembled
 * that happens to hash the same way.
 */
export type DeliberationKey = string & { readonly __deliberationKey: unique symbol };

export interface RefusedOutcome {
  ok: false;
  attempts: number;
  remaining: number;
  message: string;
}

export type DeliberationOutcome =
  | { ok: true; attempts: number; key: DeliberationKey }
  | RefusedOutcome;

/** The identity of a change: who is doing what, and how they described it. */
function deliberationKeyOf(request: DeliberationRequest): DeliberationKey {
  return contentHash(
    [request.operation, request.what, request.explanation].join("\u0000")
  ) as DeliberationKey;
}

interface Run {
  key: DeliberationKey;
  attempts: number;
  expiresAt: number;
}

export class DeliberationGate {
  private readonly requiredAttempts: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  /** Keyed, so concurrent runs over different changes do not evict each other. */
  private readonly runs = new Map<string, Run>();

  constructor(config: DeliberationConfig = {}) {
    const {
      requiredAttempts = DEFAULT_REQUIRED_ATTEMPTS,
      ttlMs = DEFAULT_DELIBERATION_TTL_MS,
      now = Date.now,
    } = config;

    if (!Number.isInteger(requiredAttempts) || requiredAttempts < 1) {
      throw new Error(
        `requiredAttempts must be a positive integer, got ${String(requiredAttempts)}`
      );
    }

    this.requiredAttempts = requiredAttempts;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  /**
   * Record an attempt and say whether the operation may proceed.
   *
   * Passing does not end the run -- call `settle` once the operation has been
   * carried out.
   */
  consider(request: DeliberationRequest): DeliberationOutcome {
    const now = this.now();

    // Swept here rather than on a timer: a gate nobody calls costs nothing,
    // and nothing has to keep the process awake to tidy up after it.
    this.evictExpired(now);

    const key = deliberationKeyOf(request);
    const attempts = this.nextAttemptCount({ key, now });

    // Recorded whether or not this attempt passes. Passing is not the same as
    // the operation having happened, and an operation that then fails must not
    // cost the caller a second round of explaining itself to the user.
    // `settle` is what ends a run, once the work is actually done.
    this.runs.set(key, { key, attempts, expiresAt: now + this.ttlMs });

    if (attempts >= this.requiredAttempts) return { ok: true, attempts, key };

    const remaining = this.requiredAttempts - attempts;
    return {
      ok: false,
      attempts,
      remaining,
      message: buildDeliberationMessage({ request, attempts, remaining }),
    };
  }

  /**
   * Put the operation behind the gate and settle it correctly on the way out.
   *
   * `consider` and `settle` are the same thing done by hand, and by hand the
   * settle is easy to lose: every early return between the two is a way to
   * leave a passed run standing, and losing it does nothing visible at the
   * time. Here the only way through is the callback.
   *
   * `succeeded` has no default on purpose. Whether a result counts as the work
   * having happened is the caller's convention -- in this repository a handler
   * reports failure by returning an error response, not by throwing, so a
   * default of "returned without throwing" would settle exactly the runs that
   * must survive. A required argument makes the caller say which it is.
   */
  async run<T>(params: {
    request: DeliberationRequest;
    work: () => Promise<T>;
    succeeded: (result: T) => boolean;
    onRefused: (outcome: RefusedOutcome) => T;
  }): Promise<T> {
    const { request, work, succeeded, onRefused } = params;

    const outcome = this.consider(request);
    if (!outcome.ok) return onRefused(outcome);

    // An exception is not a report of failure, it is the absence of one, so the
    // run stays: the caller may retry without explaining itself again.
    const result = await work();

    if (succeeded(result)) this.settle(outcome.key);
    return result;
  }

  /**
   * Where this attempt lands in a run: 1 starts a fresh one, anything higher
   * continues the stored one. Only an attempt with the same key, against a run
   * that has not expired, continues.
   */
  private nextAttemptCount(params: { key: string; now: number }): number {
    const { key, now } = params;
    const previous = this.runs.get(key);

    if (previous === undefined) return 1;
    if (now >= previous.expiresAt) return 1;
    return previous.attempts + 1;
  }

  /** Runs nobody came back to. Their TTL is the only thing that ends them. */
  private evictExpired(now: number): void {
    for (const [key, run] of this.runs) {
      if (now >= run.expiresAt) this.runs.delete(key);
    }
  }

  /**
   * End the run that just passed, once the operation it let through has
   * actually been carried out. The next identical call then starts over.
   *
   * A caller that passes the gate and then fails to do the work should not call
   * this: leaving the run standing is what lets it retry without putting the
   * user through the same explanation twice.
   */
  settle(key: DeliberationKey): void {
    this.runs.delete(key);
  }

  /**
   * How many runs are being held.
   *
   * Only for tests, and only one thing is worth asserting with it: that runs
   * nobody came back to are actually dropped. A per-key store that never shrank
   * would pass every other test in this file.
   */
  runCountForTesting(): number {
    return this.runs.size;
  }

  /**
   * Drop every run, passed or not.
   *
   * Named for its only legitimate caller. Nothing in a running server wants to
   * discard other operations' runs, and before the store was keyed this was
   * indistinguishable from settling the one run that existed.
   */
  resetAllForTesting(): void {
    this.runs.clear();
  }
}

function buildDeliberationMessage(params: {
  request: DeliberationRequest;
  attempts: number;
  remaining: number;
}): string {
  const { request, attempts, remaining } = params;
  const total = attempts + remaining;

  return `# Not Yet -- Tell the User First

This is attempt ${attempts} of ${total} for **${request.operation}**, and it has not been
carried out.

Before trying again:

1. Explain to the user, in your own words, what this change does and why you are
   making it. Do not paraphrase this message at them -- describe the change.
2. Give them a chance to say no.

Then repeat the **identical** call, including the same \`explanation\`:

> ${request.explanation}

The wording is part of what identifies this attempt. Changing the arguments --
including rephrasing the explanation -- starts a new run rather than continuing
this one, and you will be told this again.

Do not work around this by reaching for a different tool or writing the file
directly.`;
}
