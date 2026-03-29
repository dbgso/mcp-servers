/**
 * List of all field names in the plan tool's inputSchema.
 * Used by schema consistency tests to verify handler schemas are covered.
 *
 * IMPORTANT: When adding a new field to inputSchema in index.ts,
 * add it here as well. The schema consistency test will catch mismatches.
 */
export const INPUT_SCHEMA_FIELDS = [
  // Common
  "help",
  "action",
  "id",
  "force",
  "cancel",
  "title",
  "content",
  "parent",
  "dependencies",
  "dependency_reason",
  "prerequisites",
  "completion_criteria",
  "deliverables",
  "output",
  "output_what",
  "output_why",
  "output_how",
  "reason",
  "is_parallelizable",
  "parallelizable_units",
  "references",
  "status",
  "comment",
  "decision",
  "changes",
  "why",
  "references_used",
  "references_reason",
  "feedback_id",
  "interpretation",
  // submit_* common
  "self_review_ref",
  "blockers",
  "risks",
  // submit_plan specific
  "findings",
  "sources",
  // submit_do specific
  "design_decisions",
  // submit_check specific
  "test_target",
  "test_results",
  "coverage",
  // submit_act specific
  "feedback_addressed",
  // start action specific
  "prompt",
  // confirm action specific
  "review_summary",
  "evidence",
] as const;

export type InputSchemaField = (typeof INPUT_SCHEMA_FIELDS)[number];
