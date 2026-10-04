import { CRITERIA } from "mcp-shared-report";
import type { Report } from "mcp-shared-report";

/**
 * The example `describe` shows. A test holds it to `validateReport`, which is
 * what keeps the document from describing a call the server would refuse.
 */
export const EXAMPLE_REPORT: Report = {
  title: "docs/ is not shipped in the package",
  conclusion: "The rules in docs/ never reach users; only describe does",
  claims: [
    {
      statement: "The packed tarball holds no file from docs/",
      evidence: [
        {
          source: "npm pack --dry-run",
          output: "dist/      176 files\ntemplates/   5 files\nREADME.md\nLICENSE",
        },
      ],
    },
  ],
  asks: [
    {
      kind: "decision",
      what: "Choose where the enforced rules are written",
      options: [
        { label: "describe", consequence: "Ships with the package and is read on every call" },
        { label: "README", consequence: "Ships, but nothing makes a caller read it" },
      ],
      recommendation: { label: "describe", reason: "It is the one place every caller reads" },
    },
  ],
  corrections: [
    {
      said: "lint enforces the rule",
      actually: "lint does not enforce it",
      why: "Stated before reading the lint config",
    },
  ],
};

function criteriaTable(): string {
  const rows = CRITERIA.map((c) => `| ${c.id} | ${c.rule} | ${c.failure} |`).join("\n");
  return `| # | A readable report... | The failure it prevents |\n|---|---|---|\n${rows}`;
}

/** Everything `exec` takes. Its own schema names no argument, so this is the only place they are written down. */
export function buildDescribeText(): string {
  return `# report-mcp

Turns a report into a single HTML page for a person to read. Use it when you
are asked to report with this tool. You fill the fields below; you do not write
prose paragraphs or markup, and you do not choose the order -- the page does.

A report missing a required field is not written. Every problem comes back at
once, each naming the criterion its field is for.

## Call

\`exec(op: "report", title, conclusion, claims, asks, corrections?, changes?, remaining?, asides?)\`

The response is the path of the written file.

## Criteria

Every field exists for one of these.

${criteriaTable()}

## Fields

### Required

| Field | Content | Criterion |
|---|---|---|
| \`title\` | What the report is about | -- |
| \`conclusion\` | What is finished, or what the reader has to decide | R1 |
| \`claims[]\` | At least one. \`{ statement, evidence[] }\`, one claim per entry | R2 |
| \`claims[].evidence[]\` | At least one. \`{ source, output }\`: what was run, and its output verbatim -- never a summary of it | R3 |
| \`asks[]\` | What the reader has to do. Pass \`[]\` when nothing is needed; it cannot be left out | R4 |
| \`asks[]\` (decision) | \`{ kind: "decision", what, options[] (2+, each { label, consequence }), recommendation { label, reason } }\`. The recommendation's label must be one of the options | R4 |
| \`asks[]\` (action) | \`{ kind: "action", what }\` | R4 |

### Optional

| Field | Content | Criterion |
|---|---|---|
| \`corrections[]\` | \`{ said, actually, why }\`: something said earlier that was wrong | R6 |
| \`changes[]\` | \`{ what, before, after }\` | R2 |
| \`remaining[]\` | \`{ item, why }\`: work still on your side | R4 |
| \`asides[]\` | \`{ note, cost }\`: findings that are not the subject; shown collapsed | R5 |

## Page order

title and conclusion, asks, corrections, claims with their evidence, changes,
remaining, asides.

## Example

\`\`\`json
${JSON.stringify({ op: "report", ...EXAMPLE_REPORT }, null, 2)}
\`\`\`
`;
}
