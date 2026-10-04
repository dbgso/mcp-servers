import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { looseArray } from "mcp-shared";
import { formatProblems, renderHtml, validateReport, type Problem } from "mcp-shared-report";
import { reportFileName, writeNewFile } from "../output.js";
import type { Op } from "./types.js";

/**
 * The report's list fields, restored from the strings a client sends them as.
 *
 * `exec` publishes no argument, so a client has no type to convert to and
 * sends an array as its JSON text (`policy__mcp-tool-surface`, "Arguments
 * arrive as strings"). Only the decoding happens here; whether the result is
 * a valid report is `validateReport`'s question, so this accepts anything and
 * leaves every problem to be reported in one place.
 */
const listFields = z
  .object({
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

/**
 * A list field still a string after decoding was JSON text that did not parse.
 * The validator only sees "a string where a list goes", which reads as though
 * JSON text were not accepted at all; this says what actually went wrong.
 */
function explainUndecoded(params: { problem: Problem; input: Record<string, unknown> }): Problem {
  const { problem, input } = params;
  const undecoded = problem.path in listFields.shape && typeof input[problem.path] === "string";
  return undecoded ? { ...problem, message: "a list, or its JSON text; this text is not valid JSON" } : problem;
}

/** `op` selects this operation and is not part of the report. */
function reportInput(params: { args: Record<string, unknown> }): Record<string, unknown> {
  const { args } = params;
  return Object.fromEntries(Object.entries(listFields.parse(args)).filter(([key]) => key !== "op"));
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
