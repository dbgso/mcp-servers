import { z } from "zod";
import type { Problem, Report, ValidationResult } from "./types.js";

/** A string that says something: whitespace alone does not count. */
const text = z.string().trim().min(1, "must not be empty");

const evidenceSchema = z
  .object({
    source: text.describe("What was run: a command, a file, a URL"),
    output: text.describe("What it printed, verbatim -- never a summary"),
  })
  .strict();

const claimSchema = z
  .object({
    statement: text,
    evidence: z.array(evidenceSchema).min(1, "at least one evidence is required"),
  })
  .strict();

/** A comparison needs something to compare against, and each row says what speaks for and against it (R9). */
const optionsSchema = z
  .array(z.object({ label: text, pros: text.describe("What speaks for it"), cons: text.describe("What speaks against it") }).strict())
  .min(2, "at least two options are required; a comparison needs an alternative");

const pickSchema = z.object({ label: text, reason: text }).strict();

/** The picked label names a row of the comparison, or the reader cannot tell which one it is. */
function picksAnOption(params: { options: { label: string }[]; picked: { label: string } }): boolean {
  const { options, picked } = params;
  return options.some((option) => option.label === picked.label);
}

const PICK_MISSES = "must be the label of one of the options";

const decisionSchema = z
  .object({
    kind: z.literal("decision"),
    what: text,
    options: optionsSchema,
    recommendation: pickSchema,
  })
  .strict();

const actionSchema = z
  .object({
    kind: z.literal("action"),
    what: text,
  })
  .strict();

const decisionMadeSchema = z
  .object({
    what: text,
    options: optionsSchema,
    chosen: pickSchema,
  })
  .strict()
  .refine((decision) => picksAnOption({ options: decision.options, picked: decision.chosen }), {
    path: ["chosen", "label"],
    message: PICK_MISSES,
  });

/**
 * Refined per element rather than on the whole report, so that it runs even
 * when another field is wrong and its problem is returned with the rest.
 */
const askSchema = z
  .discriminatedUnion("kind", [decisionSchema, actionSchema])
  // A recommendation naming no option cannot be picked.
  .refine((ask) => ask.kind === "action" || picksAnOption({ options: ask.options, picked: ask.recommendation }), {
    path: ["recommendation", "label"],
    message: PICK_MISSES,
  });

/**
 * Every object is strict. A field the structure does not have would be dropped
 * from the page without a word, so the caller would believe the reader saw it.
 */
export const reportSchema = z
  .object({
    title: text.describe("What the report is about"),
    conclusion: text.describe("R1: what is finished, or what the reader has to decide"),
    background: text.describe("R7: why the work was done -- who asked for what, or what you noticed"),
    impact: z
      .object({
        ifLeft: text.describe("R10: what happens if the work is not done"),
        scope: z
          .array(
            z
              .object({
                who: text.describe("Who is affected"),
                what: text.describe("What changes for them"),
                when: text.describe("From when, e.g. after the PR is merged"),
                where: text.describe("Where: a file, a tool, a screen"),
                why: text.describe("Why it changes"),
                how: text.describe("What the affected party has to do"),
              })
              .strict(),
          )
          .min(1, "at least one target is required; say what the work reaches")
          .describe("R10, R11: what doing the work reaches, one entry per affected party, in 5W1H"),
      })
      .strict(),
    claims: z.array(claimSchema).min(1, "at least one claim is required").describe("R2, R3: one claim per entry, each with raw evidence"),
    asks: z.array(askSchema).describe("R4: what the reader has to decide or do; [] when nothing"),
    decisions: z.array(decisionMadeSchema).describe("R8, R9: what you decided on your own, with every option weighed; [] when nothing"),
    corrections: z
      .array(z.object({ said: text, actually: text, why: text }).strict())
      .optional()
      .describe("R6: something said earlier that was wrong"),
    changes: z.array(z.object({ what: text, before: text, after: text }).strict()).optional(),
    remaining: z.array(z.object({ item: text, why: text }).strict()).optional().describe("Work still on your side"),
    asides: z
      .array(z.object({ note: text, cost: text }).strict())
      .optional()
      .describe("R5: findings that are not the subject; cost is what leaving them costs"),
  })
  .strict();

/**
 * Which criterion a field serves, by the path to it.
 *
 * Checked in order, so the more specific entry comes first: evidence is R3
 * even though the claim around it is R2.
 */
const CRITERION_BY_PATH: readonly { pattern: RegExp; criterion: string }[] = [
  { pattern: /^conclusion/, criterion: "R1" },
  { pattern: /^background/, criterion: "R7" },
  { pattern: /^impact\.scope\[\d+\]\./, criterion: "R11" },
  { pattern: /^impact/, criterion: "R10" },
  { pattern: /^decisions\[\d+\]\.options/, criterion: "R9" },
  { pattern: /^asks\[\d+\]\.options/, criterion: "R9" },
  { pattern: /^decisions/, criterion: "R8" },
  { pattern: /^claims\[\d+\]\.evidence/, criterion: "R3" },
  { pattern: /^claims/, criterion: "R2" },
  { pattern: /^asks/, criterion: "R4" },
  { pattern: /^remaining/, criterion: "R4" },
  { pattern: /^asides/, criterion: "R5" },
  { pattern: /^corrections/, criterion: "R6" },
  { pattern: /^changes/, criterion: "R2" },
];

/** `["claims", 1, "evidence"]` as `claims[1].evidence`. */
function formatPath(params: { path: (string | number)[] }): string {
  const { path } = params;
  return path.reduce<string>((joined, key) => {
    if (typeof key === "number") return `${joined}[${key}]`;
    if (joined === "") return key;
    return `${joined}.${key}`;
  }, "");
}

/** Where zod's own message names the problem less plainly than this. */
const MESSAGE_BY_CODE: Partial<Record<z.ZodIssueCode, string>> = {
  // zod's lists the values with its own wording; this says them as fields would.
  [z.ZodIssueCode.invalid_union_discriminator]: 'must be "decision" or "action"',
};

function isAbsent(params: { issue: z.ZodIssue }): boolean {
  const { issue } = params;
  return issue.code === z.ZodIssueCode.invalid_type && issue.received === "undefined";
}

/** An absent field reads better as "required" than as zod's type mismatch. */
function messageFor(params: { issue: z.ZodIssue }): string {
  const { issue } = params;
  if (isAbsent({ issue })) return "required";
  return MESSAGE_BY_CODE[issue.code] ?? issue.message;
}

/** Lists that may be empty but not omitted, and how to say "nothing" for each. */
const WHEN_EMPTY: Record<string, string> = {
  asks: "required; pass [] if nothing is needed from the reader",
  decisions: "required; pass [] if you decided nothing on your own",
};

function adviceFor(params: { path: string; message: string }): string {
  const { path, message } = params;
  if (message !== "required") return message;
  return WHEN_EMPTY[path] ?? message;
}

function problemAt(params: { path: (string | number)[]; message: string }): Problem {
  const path = formatPath({ path: params.path });
  const message = adviceFor({ path, message: params.message });
  const criterion = CRITERION_BY_PATH.find((entry) => entry.pattern.test(path))?.criterion;
  return criterion === undefined ? { path, message } : { path, message, criterion };
}

/**
 * One problem per issue, except that each unknown field is its own problem,
 * at its own path, so the caller sees which key to move or remove.
 */
function toProblems(params: { issue: z.ZodIssue }): Problem[] {
  const { issue } = params;
  if (issue.code === z.ZodIssueCode.unrecognized_keys) {
    return issue.keys.map((key) =>
      problemAt({ path: [...issue.path, key], message: "not a field of the report; it would not reach the page" }),
    );
  }
  return [problemAt({ path: issue.path, message: messageFor({ issue }) })];
}

/**
 * Check an input against the report structure.
 *
 * Every problem is returned at once. Sending them back one at a time would
 * turn one correction into as many round trips as there are missing fields.
 */
export function validateReport(params: { input: unknown }): ValidationResult {
  const { input } = params;
  const parsed = reportSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, report: parsed.data as Report };
  }
  return { ok: false, problems: parsed.error.issues.flatMap((issue) => toProblems({ issue })) };
}

/** Problems as the lines a caller reads, one per problem. */
export function formatProblems(params: { problems: Problem[] }): string {
  const { problems } = params;
  return problems
    .map((problem) => {
      const tag = problem.criterion === undefined ? "" : ` (${problem.criterion})`;
      return `- ${problem.path || "(input)"}: ${problem.message}${tag}`;
    })
    .join("\n");
}
