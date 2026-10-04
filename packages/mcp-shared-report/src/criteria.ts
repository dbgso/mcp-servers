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
];
