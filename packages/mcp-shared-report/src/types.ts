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

/** Something the reader has to do (R4). */
export interface ActionAsk {
  kind: "action";
  what: string;
}

export type Ask = DecisionAsk | ActionAsk;

/** Something the reporter decided on their own, with every option they weighed (R8). */
export interface Decision {
  what: string;
  /** Two or more, the chosen one among them. */
  options: DecisionOption[];
  chosen: Recommendation;
}

/** A correction to something said earlier (R6). */
export interface Correction {
  said: string;
  actually: string;
  why: string;
}

export interface Change {
  what: string;
  before: string;
  after: string;
}

/** Work still left on the reporter's side. */
export interface Remaining {
  item: string;
  why: string;
}

/** A finding that is not the subject of the report (R5). */
export interface Aside {
  note: string;
  /** What leaving it alone costs. */
  cost: string;
}

export interface Report {
  title: string;
  conclusion: string;
  /** Why the work was done: who asked for what, or what was noticed (R7). */
  background: string;
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
