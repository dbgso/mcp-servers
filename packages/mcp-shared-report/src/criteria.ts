/**
 * The readability criteria a report is held to.
 *
 * Written before the fields, per `policy__criterion-before-detection`: every
 * field exists for one of these, and a validation problem names the one its
 * field serves so the caller can tell why it is being asked for.
 */
export interface Criterion {
  id: string;
  /** What a readable report does. */
  rule: string;
  /** The failure that made it a criterion. */
  failure: string;
}

export const CRITERIA: readonly Criterion[] = [
  {
    id: "R1",
    rule: "The conclusion comes first",
    failure: "Written in the order the work was done: history, failure, fix",
  },
  {
    id: "R2",
    rule: "One fact per item",
    failure: "Two facts and a consequence packed into one sentence",
  },
  {
    id: "R3",
    rule: "A claim carries its raw evidence",
    failure: "Paraphrased a measurement instead of pasting it",
  },
  {
    id: "R4",
    rule: "What the reader has to do stands apart",
    failure: "A decision the reader had to make was buried in the text",
  },
  {
    id: "R5",
    rule: "Asides sit apart from the subject",
    failure: "An unasked-for finding listed alongside the subject",
  },
  {
    id: "R6",
    rule: "A correction is shown as a correction",
    failure: "Overwrote an earlier explanation without saying it was wrong",
  },
  {
    id: "R7",
    rule: "Why the work was done is stated",
    failure: "Left out what started the work, so the reader could not tell why it was done",
  },
  {
    id: "R8",
    rule: "A decision made alone shows what was turned down and why",
    failure: "Stated the approach taken, with no alternatives or grounds the reader could check",
  },
  {
    id: "R9",
    rule: "Options are compared in a table of pros and cons",
    failure: "Listed the options as bullets, so their pros and cons could not be set side by side",
  },
];
