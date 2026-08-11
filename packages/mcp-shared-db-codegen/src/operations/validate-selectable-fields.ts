/**
 * `validate_selectable_fields` op.
 *
 * Reads the live DB schema via the introspector, loads the user's
 * `selectable-fields.json` from disk, and runs the pure
 * `validateSelectableFieldsCoverage` over the pair so the caller sees:
 *   - tables / fields drift between metadata and the whitelist
 *   - PII flags missing a `piiReason` (lint, severity: warn)
 *
 * The op intentionally does NOT also load the user's `metadata.json` —
 * the live introspection is the source of truth, so drift caused by a
 * stale metadata file is caught implicitly.
 */
import { promises as fs } from "node:fs";
import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import {
  validateSelectableFieldsCoverage,
  type SelectableFieldsMap,
} from "mcp-shared-db-core";
import type { CodegenOperation } from "./types.js";
import { introspectAllTables } from "./introspect-all-helper.js";
import { toRdbMetadataMap } from "../format/to-rdb-metadata.js";

const argsSchema = z.object({
  schema: z.string().min(1).describe("Schema name"),
  selectable_fields_path: z
    .string()
    .min(1)
    .describe("Absolute or cwd-relative path to the selectable-fields.json file"),
  tables: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe(
      "Optional explicit table list. Omit to validate every table in the schema.",
    ),
});

type ValidateArgs = z.infer<typeof argsSchema>;

async function readSelectableFields(filePath: string): Promise<SelectableFieldsMap> {
  const buf = await fs.readFile(filePath, "utf8");
  // JSON.parse can throw with a vague message; surface the path so the caller
  // can correct it without guessing which arg was wrong.
  try {
    return JSON.parse(buf) as SelectableFieldsMap;
  } catch (err) {
    throw new Error(
      `Failed to parse selectable_fields_path '${filePath}': ${(err as Error).message}`,
    );
  }
}

export const validateSelectableFieldsOp: CodegenOperation<ValidateArgs> = {
  id: "validate_selectable_fields",
  summary: "Cross-check `selectable-fields.json` against the live DB schema",
  detail: `Returns \`{ issues, summary }\`. Issue kinds:
- missing_table / orphan_table — drift at the table level (severity: error)
- missing_field / orphan_field — drift at the field level (severity: error)
- missing_pii_reason          — pii: true with empty piiReason (severity: warn)
- pii_on_temporal             — pii: true on timestamp/datetime/date/time (warn)
- pii_on_boolean              — pii: true on boolean/tinyint(1) (warn)
- pii_on_enum                 — pii: true on enum(...) (warn)
- pii_on_numeric_fk           — pii: true on numeric *_id/id columns (warn)

The four \`pii_on_*\` warns catch a known AI failure mode: marking every column
on a PII-heavy table as PII regardless of content (e.g. \`created_at\` flagged).
\`summary.likelyOverApplication\` is true when one table emits 3+ same-kind
warns or the DB emits 10+ same-kind warns — treat that as a signal to re-run
PII judgement, not just clear individual warns. Edge cases (\`date\`
birthdates, gender enums) are warns, not errors, so legitimate PII is kept.

Live introspection is the source of truth — if your \`metadata.json\` is stale
the issues will reveal it indirectly.`,
  category: "Read",
  argsSchema,
  execute: async ({ args, ctx }) => {
    const tables = await introspectAllTables({
      introspector: ctx.introspector,
      schema: args.schema,
      ...(args.tables !== undefined && { tables: args.tables }),
    });
    const metadata = toRdbMetadataMap(tables);
    const selectableFields = await readSelectableFields(args.selectable_fields_path);
    const result = validateSelectableFieldsCoverage({ metadata, selectableFields });
    return jsonResponse(result);
  },
};
