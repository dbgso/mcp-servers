import { z } from "zod";
import type { Problem, Report, ValidationResult } from "./types.js";

/** A string that says something: whitespace alone does not count. */
const text = z.string().trim().min(1, "must not be empty");

const evidenceSchema = z
  .object({
    source: text,
    output: text,
  })
  .strict();

const claimSchema = z
  .object({
    statement: text,
    evidence: z.array(evidenceSchema).min(1, "at least one evidence is required"),
  })
  .strict();

const decisionSchema = z
  .object({
    kind: z.literal("decision"),
    what: text,
    options: z
      .array(z.object({ label: text, consequence: text }).strict())
      .min(2, "a decision needs at least two options"),
    recommendation: z.object({ label: text, reason: text }).strict(),
  })
  .strict();

const actionSchema = z
  .object({
    kind: z.literal("action"),
    what: text,
  })
  .strict();

/**
 * Refined per element rather than on the whole report, so that it runs even
 * when another field is wrong and its problem is returned with the rest.
 */
const askSchema = z
  .discriminatedUnion("kind", [decisionSchema, actionSchema])
  // A recommendation naming no option cannot be picked.
  .refine(
    (ask) => ask.kind === "action" || ask.options.some((option) => option.label === ask.recommendation.label),
    { path: ["recommendation", "label"], message: "must be the label of one of the options" },
  );

/**
 * Every object is strict. A field the structure does not have would be dropped
 * from the page without a word, so the caller would believe the reader saw it.
 */
const reportSchema = z
  .object({
    title: text,
    conclusion: text,
    claims: z.array(claimSchema).min(1, "at least one claim is required"),
    asks: z.array(askSchema),
    corrections: z.array(z.object({ said: text, actually: text, why: text }).strict()).optional(),
    changes: z.array(z.object({ what: text, before: text, after: text }).strict()).optional(),
    remaining: z.array(z.object({ item: text, why: text }).strict()).optional(),
    asides: z.array(z.object({ note: text, cost: text }).strict()).optional(),
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

/** `asks` may be empty but not omitted, and the message says how to say "nothing". */
function adviceFor(params: { path: string; message: string }): string {
  const { path, message } = params;
  if (path === "asks" && message === "required") {
    return "required; pass [] if nothing is needed from the reader";
  }
  return message;
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
