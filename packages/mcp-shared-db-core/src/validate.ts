/**
 * Pure validator for `selectable-fields` coverage against a structural
 * `metadata` map. The codegen MCP wraps this with introspection + filesystem
 * I/O; the core function itself is data-in / data-out so it stays trivially
 * unit-testable.
 *
 * Issue kinds:
 *   - missing_table:      metadata has a table the selectableFields map omits
 *   - orphan_table:       selectableFields lists a table metadata doesn't know
 *   - missing_field:      a metadata field is absent from selectableFields
 *   - orphan_field:       a selectableFields field is absent from metadata
 *   - missing_pii_reason: pii: true with empty/missing piiReason (lint, warn)
 *   - pii_on_temporal:    pii: true on `timestamp`/`datetime`/`date`/`time` (warn)
 *   - pii_on_boolean:     pii: true on `boolean`/`tinyint(1)` (warn)
 *   - pii_on_enum:        pii: true on `enum(...)` (warn)
 *   - pii_on_numeric_fk:  pii: true on numeric `*_id`/`id` columns (warn)
 *
 * The four `pii_on_*` kinds catch a known AI failure mode: marking every
 * column on a PII-heavy table as `pii: true` regardless of actual content
 * (e.g. `created_at` flagged as PII). Severity is `warn` because edge cases
 * exist (`date` birthdates, gender enums) — see the design doc at
 * `tmp/docs/flows/plans/2026-05-09_pii-overapply-guard.md`.
 */
import type { GenericFieldMetadata } from "./metadata.js";
import {
  classifyNativeType,
  looksLikeForeignKeyName,
} from "./native-type-classifier.js";
import type { RdbTableMetadataMap } from "./rdb-metadata.js";
import {
  getEffectiveNote,
  getEffectivePolicy,
  type SelectableFieldsMap,
} from "./selectable-fields.js";

export type ValidationIssueKind =
  | "missing_table"
  | "orphan_table"
  | "missing_field"
  | "orphan_field"
  | "missing_pii_reason"
  | "pii_on_temporal"
  | "pii_on_boolean"
  | "pii_on_enum"
  | "pii_on_numeric_fk";

export interface ValidationIssue {
  kind: ValidationIssueKind;
  table: string;
  field?: string;
  severity: "error" | "warn";
  message?: string;
}

/** Per-kind tally for the four over-apply heuristics. */
export interface PiiOverapplyByKind {
  temporal: number;
  boolean: number;
  enum: number;
  numericFk: number;
}

export interface ValidationSummary {
  tablesChecked: number;
  fieldsChecked: number;
  piiMarkedCount: number;
  issuesByKind: Record<string, number>;
  /** Aggregated counts of the four `pii_on_*` over-apply heuristics. */
  piiOverapplyByKind: PiiOverapplyByKind;
  /**
   * True when over-apply warns reach a threshold suggesting AI/reviewer
   * mass-mis-labelled a table or the whole DB. Surfaced separately so a
   * caller scanning a long warn list can spot the pattern at a glance.
   *
   * Thresholds (any one trips the flag):
   *   - any single table emits 3+ over-apply warns of the same kind
   *   - the entire DB emits 10+ over-apply warns of the same kind
   */
  likelyOverApplication: boolean;
}

export interface ValidateSelectableFieldsCoverageParams {
  metadata: RdbTableMetadataMap;
  selectableFields: SelectableFieldsMap;
}

export interface ValidateSelectableFieldsCoverageResult {
  issues: ValidationIssue[];
  summary: ValidationSummary;
}

/** Threshold: same-kind warn count within one table that flips `likelyOverApplication`. */
const PER_TABLE_OVERAPPLY_THRESHOLD = 3;
/** Threshold: same-kind warn count across the whole DB that flips `likelyOverApplication`. */
const GLOBAL_OVERAPPLY_THRESHOLD = 10;

/** Track issue counts so the summary is built in a single pass. */
function bumpKind(params: { map: Record<string, number>; kind: ValidationIssueKind }): void {
  const { map, kind } = params;
  map[kind] = (map[kind] ?? 0) + 1;
}

const OVERAPPLY_KIND_TO_BUCKET: Record<
  "pii_on_temporal" | "pii_on_boolean" | "pii_on_enum" | "pii_on_numeric_fk",
  keyof PiiOverapplyByKind
> = {
  pii_on_temporal: "temporal",
  pii_on_boolean: "boolean",
  pii_on_enum: "enum",
  pii_on_numeric_fk: "numericFk",
};

interface PushOverApplyParams {
  issues: ValidationIssue[];
  issuesByKind: Record<string, number>;
  globalOverapply: PiiOverapplyByKind;
  perTableOverapply: PiiOverapplyByKind;
  kind: keyof typeof OVERAPPLY_KIND_TO_BUCKET;
  table: string;
  field: string;
  nativeType: string | undefined;
  reasonHint: string;
}

/** Emit a single `pii_on_*` warn and update both per-table and global counters. */
function pushOverApply(params: PushOverApplyParams): void {
  const { issues, issuesByKind, globalOverapply, perTableOverapply, kind, table, field, nativeType, reasonHint } = params;
  issues.push({
    kind,
    table,
    field,
    severity: "warn",
    message: `Field '${field}' is flagged pii: true but nativeType '${nativeType ?? "<unknown>"}' is ${reasonHint} — re-check whether the value alone identifies a person`,
  });
  bumpKind({ map: issuesByKind, kind: kind });
  const bucket = OVERAPPLY_KIND_TO_BUCKET[kind];
  globalOverapply[bucket] += 1;
  perTableOverapply[bucket] += 1;
}

interface CheckTablePairParams {
  table: string;
  metadataFields: Record<string, GenericFieldMetadata>;
  selectableFields: SelectableFieldsMap[string];
  issues: ValidationIssue[];
  issuesByKind: Record<string, number>;
  globalOverapply: PiiOverapplyByKind;
}

interface CheckTablePairResult {
  fieldsChecked: number;
  piiMarkedCount: number;
  /** Highest per-kind over-apply count observed within this table. */
  maxPerTableOverapply: number;
}

function checkTablePair(params: CheckTablePairParams): CheckTablePairResult {
  const { table, metadataFields, selectableFields, issues, issuesByKind, globalOverapply } = params;
  const metadataNames = Object.keys(metadataFields);
  const selectableNames = Object.keys(selectableFields.fields);
  const metadataSet = new Set(metadataNames);
  const selectableSet = new Set(selectableNames);

  for (const f of metadataNames) {
    if (!selectableSet.has(f)) {
      issues.push({
        kind: "missing_field",
        table,
        field: f,
        severity: "error",
        message: `Field '${f}' exists in metadata but not in selectableFields`,
      });
      bumpKind({ map: issuesByKind, kind: "missing_field" });
    }
  }
  for (const f of selectableNames) {
    if (!metadataSet.has(f)) {
      issues.push({
        kind: "orphan_field",
        table,
        field: f,
        severity: "error",
        message: `Field '${f}' is in selectableFields but missing from metadata`,
      });
      bumpKind({ map: issuesByKind, kind: "orphan_field" });
    }
  }

  // Redact-policy lint + over-apply pass — only fields that actually exist
  // on both sides. We count any effective policy of "redact" as a
  // pii-marked field for the over-apply heuristic, regardless of whether
  // the operator used `select: "redact"` or the legacy `pii: true` flag.
  let piiMarkedCount = 0;
  const perTableOverapply: PiiOverapplyByKind = {
    temporal: 0,
    boolean: 0,
    enum: 0,
    numericFk: 0,
  };
  for (const [name, info] of Object.entries(selectableFields.fields)) {
    if (getEffectivePolicy(info) !== "redact") continue;
    // Skip the heuristic for fields that don't explicitly opt in to
    // redact — the new secure-by-default makes "no flag at all" land on
    // redact, but we shouldn't dump 30 warns on an unmigrated config.
    // The operator-typed signal is `select === "redact"` OR legacy
    // `pii === true`; anything else (purely defaulted) we leave alone.
    const explicitlyRedacted = info.select === "redact" || info.pii === true;
    if (!explicitlyRedacted) continue;
    piiMarkedCount += 1;
    const reason = getEffectiveNote(info);
    if (!reason) {
      issues.push({
        kind: "missing_pii_reason",
        table,
        field: name,
        severity: "warn",
        message: `Field '${name}' has select: "redact" (or legacy pii: true) but no note/piiReason`,
      });
      bumpKind({ map: issuesByKind, kind: "missing_pii_reason" });
    }

    // Over-apply heuristic — skip when the column is missing from metadata
    // (orphan_field already covers that).
    const meta = metadataFields[name];
    if (!meta) continue;
    const cls = classifyNativeType(meta.nativeType);
    const baseArgs = {
      issues,
      issuesByKind,
      globalOverapply,
      perTableOverapply,
      table,
      field: name,
      nativeType: meta.nativeType,
    };
    if (cls === "temporal") {
      pushOverApply({
        ...baseArgs,
        kind: "pii_on_temporal",
        reasonHint: "a bare date/time value (not free text)",
      });
    } else if (cls === "boolean") {
      pushOverApply({
        ...baseArgs,
        kind: "pii_on_boolean",
        reasonHint: "a boolean flag",
      });
    } else if (cls === "enum") {
      pushOverApply({
        ...baseArgs,
        kind: "pii_on_enum",
        reasonHint: "a fixed-set enum (not free text)",
      });
    } else if (cls === "numeric" && looksLikeForeignKeyName(name)) {
      pushOverApply({
        ...baseArgs,
        kind: "pii_on_numeric_fk",
        reasonHint: "a numeric foreign-key id (does not identify a person on its own)",
      });
    }
  }

  const maxPerTableOverapply = Math.max(
    perTableOverapply.temporal,
    perTableOverapply.boolean,
    perTableOverapply.enum,
    perTableOverapply.numericFk,
  );

  return { fieldsChecked: selectableNames.length, piiMarkedCount, maxPerTableOverapply };
}

function exceedsGlobalThreshold(globalOverapply: PiiOverapplyByKind): boolean {
  return (
    globalOverapply.temporal >= GLOBAL_OVERAPPLY_THRESHOLD ||
    globalOverapply.boolean >= GLOBAL_OVERAPPLY_THRESHOLD ||
    globalOverapply.enum >= GLOBAL_OVERAPPLY_THRESHOLD ||
    globalOverapply.numericFk >= GLOBAL_OVERAPPLY_THRESHOLD
  );
}

export function validateSelectableFieldsCoverage(
  params: ValidateSelectableFieldsCoverageParams,
): ValidateSelectableFieldsCoverageResult {
  const { metadata, selectableFields } = params;
  const issues: ValidationIssue[] = [];
  const issuesByKind: Record<string, number> = {};
  const globalOverapply: PiiOverapplyByKind = {
    temporal: 0,
    boolean: 0,
    enum: 0,
    numericFk: 0,
  };

  const metadataTables = new Set(Object.keys(metadata));
  const selectableTables = new Set(Object.keys(selectableFields));

  for (const t of metadataTables) {
    if (!selectableTables.has(t)) {
      issues.push({
        kind: "missing_table",
        table: t,
        severity: "error",
        message: `Table '${t}' exists in metadata but not in selectableFields`,
      });
      bumpKind({ map: issuesByKind, kind: "missing_table" });
    }
  }
  for (const t of selectableTables) {
    if (!metadataTables.has(t)) {
      issues.push({
        kind: "orphan_table",
        table: t,
        severity: "error",
        message: `Table '${t}' is in selectableFields but missing from metadata`,
      });
      bumpKind({ map: issuesByKind, kind: "orphan_table" });
    }
  }

  let fieldsChecked = 0;
  let piiMarkedCount = 0;
  let tablesChecked = 0;
  let anyPerTableExceeded = false;
  for (const [table, meta] of Object.entries(metadata)) {
    const sel = selectableFields[table];
    if (!sel) continue;
    tablesChecked += 1;
    const r = checkTablePair({
      table,
      metadataFields: meta.fields,
      selectableFields: sel,
      issues,
      issuesByKind,
      globalOverapply,
    });
    fieldsChecked += r.fieldsChecked;
    piiMarkedCount += r.piiMarkedCount;
    if (r.maxPerTableOverapply >= PER_TABLE_OVERAPPLY_THRESHOLD) {
      anyPerTableExceeded = true;
    }
  }

  const likelyOverApplication = anyPerTableExceeded || exceedsGlobalThreshold(globalOverapply);

  return {
    issues,
    summary: {
      tablesChecked,
      fieldsChecked,
      piiMarkedCount,
      issuesByKind,
      piiOverapplyByKind: globalOverapply,
      likelyOverApplication,
    },
  };
}
