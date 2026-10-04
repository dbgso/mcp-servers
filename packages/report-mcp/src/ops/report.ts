import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { looseArray } from "mcp-shared";
import { formatProblems, renderHtml, validateReport, type Problem } from "mcp-shared-report";
import { reportFileName, writeNewFile } from "../output.js";
import type { Op } from "./types.js";

function parseJson(params: { text: string }): unknown {
  try {
    return JSON.parse(params.text);
  } catch {
    return params.text;
  }
}

/** An object in a string: `'{"a":1}'`. Anything else is left for the validator to judge. */
function objectFromString(value: unknown): unknown {
  if (typeof value !== "string" || !value.trimStart().startsWith("{")) return value;
  return parseJson({ text: value });
}

/**
 * The report's list and object fields, restored from the strings a client
 * sends them as.
 *
 * `exec` publishes no argument, so a client has no type to convert to and
 * sends an array or object as its JSON text (`policy__mcp-tool-surface`, "Arguments
 * arrive as strings"). Only the decoding happens here; whether the result is
 * a valid report is `validateReport`'s question, so this accepts anything and
 * leaves every problem to be reported in one place.
 */
const encodedFields = z
  .object({
    impact: z.preprocess(objectFromString, z.unknown()),
    claims: looseArray(z.unknown()),
    asks: looseArray(z.unknown()),
    decisions: looseArray(z.unknown()),
    corrections: looseArray(z.unknown()),
    changes: looseArray(z.unknown()),
    remaining: looseArray(z.unknown()),
    asides: looseArray(z.unknown()),
  })
  .partial()
  .passthrough();

/** What a field still a string after decoding should have been. Lists unless named here. */
const EXPECTED: Record<string, string> = { impact: "an object" };

/**
 * A field still a string after decoding was JSON text that did not parse.
 * The validator only sees "a string where a list goes", which reads as though
 * JSON text were not accepted at all; this says what actually went wrong.
 */
function isUndecoded(params: { path: string; input: Record<string, unknown> }): boolean {
  const { path, input } = params;
  return path in encodedFields.shape && typeof input[path] === "string";
}

function explainUndecoded(params: { problem: Problem; input: Record<string, unknown> }): Problem {
  const { problem, input } = params;
  if (!isUndecoded({ path: problem.path, input })) return problem;
  const expected = EXPECTED[problem.path] ?? "a list";
  return { ...problem, message: `${expected}, or its JSON text; this text is not valid JSON` };
}

/** `op` selects this operation and is not part of the report. */
function reportInput(params: { args: Record<string, unknown> }): Record<string, unknown> {
  const { args } = params;
  return Object.fromEntries(Object.entries(encodedFields.parse(args)).filter(([key]) => key !== "op"));
}

/**
 * Validate a report and write it as an HTML page.
 *
 * Nothing is written unless the report is complete: a report that does not
 * hold to the structure never reaches the person it was for.
 */
export class ReportOp implements Op {
  readonly name = "report";

  constructor(
    private readonly outputDir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const input = reportInput({ args });
    const result = validateReport({ input });
    if (!result.ok) {
      const problems = result.problems.map((problem) => explainUndecoded({ problem, input }));
      const count = problems.length;
      return {
        content: [
          {
            type: "text",
            text:
              `The report was not written. ${count} ${count === 1 ? "problem" : "problems"}:\n` +
              `${formatProblems({ problems })}\n\n` +
              "Call `describe` for the structure and what each field is for.",
          },
        ],
        isError: true,
      };
    }

    const filePath = await writeNewFile({
      dir: this.outputDir,
      baseName: reportFileName({ title: result.report.title, now: this.now() }),
      extension: "html",
      content: renderHtml({ report: result.report }),
    });
    return { content: [{ type: "text", text: `Report written: ${filePath}` }] };
  }
}
