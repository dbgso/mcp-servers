/**
 * The structure of a report, field for field as the spec "報告構造の仕様"
 * defines it (docs/chain/spec/01M42J5FD0DVHH7DFJETNJ18GS.md).
 *
 * A caller fills these fields and nothing else: no prose paragraphs, no markup.
 * The order a reader sees them in is fixed by the renderer, not chosen here.
 */

/** The output of something that was run, pasted rather than paraphrased (R3). */
export interface Evidence {
  /** What was run: a command, a file, a URL. */
  source: string;
  /** What it printed, verbatim. */
  output: string;
}

/** One claim and what supports it (R2, R3). */
export interface Claim {
  statement: string;
  evidence: Evidence[];
}

/** One row of a comparison: an option and what speaks for and against it (R9). */
export interface DecisionOption {
  label: string;
  pros: string;
  cons: string;
}

/** The option picked out of a comparison, and why it was picked over the rest. */
export interface Recommendation {
  /** The `label` of one of the options. */
  label: string;
  reason: string;
}

/** Something the reader has to decide (R4). */
export interface DecisionAsk {
  kind: "decision";
  what: string;
  options: DecisionOption[];
  recommendation: Recommendation;
}

/**
 * Who does what, when, where, why and how: every part of a piece of work or
 * an effect a reader needs, each its own field so none is left out (R11, R12).
 */
export interface FiveW1H {
  who: string;
  what: string;
  when: string;
  where: string;
  why: string;
  how: string;
}

/** Something the reader has to do, in 5W1H (R4, R12). */
export interface ActionAsk extends FiveW1H {
  kind: "action";
}

export type Ask = DecisionAsk | ActionAsk;

/** Something the reporter decided on their own, with every option they weighed (R8). */
export interface Decision {
  what: string;
  /** Two or more, the chosen one among them. */
  options: DecisionOption[];
  chosen: Recommendation;
}

/**
 * One thing the work reaches (R11): who is affected, what changes for them,
 * from when, where, why, and what they have to do.
 */
export type ImpactTarget = FiveW1H;

/** What leaving the work undone costs, and what doing it touches (R10). */
export interface Impact {
  ifLeft: string;
  /** One or more. */
  scope: ImpactTarget[];
}

/** A correction to something said earlier (R6). */
export interface Correction {
  said: string;
  actually: string;
  why: string;
}

export interface Change {
  what: string;
  /** Where it changed: a file, a tool, a screen (R13). */
  where: string;
  before: string;
  after: string;
}

/**
 * Work still left on the reporter's side (R12): who holds it, what it is,
 * when it ends or what it waits on, where, why it is left, and how it goes on.
 */
export type Remaining = FiveW1H;

/** A finding that is not the subject of the report (R5). */
export interface Aside {
  note: string;
  /** Where it was found (R13). */
  where: string;
  /** What leaving it alone costs. */
  cost: string;
}

export interface Report {
  title: string;
  conclusion: string;
  /** Why the work was done: who asked for what, or what was noticed (R7). */
  background: string;
  impact: Impact;
  claims: Claim[];
  /** May be empty, which renders as "nothing needed"; may not be omitted. */
  asks: Ask[];
  /** May be empty, which renders as "none"; may not be omitted. */
  decisions: Decision[];
  corrections?: Correction[];
  changes?: Change[];
  remaining?: Remaining[];
  asides?: Aside[];
}

/** One way an input falls short of the structure. */
export interface Problem {
  /** Where, as `claims[1].evidence`. */
  path: string;
  message: string;
  /** The readability criterion the field exists for, such as `R3`. */
  criterion?: string;
}

export type ValidationResult =
  | { ok: true; report: Report }
  | { ok: false; problems: Problem[] };
