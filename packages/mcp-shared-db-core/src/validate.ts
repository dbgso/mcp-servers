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
  type NativeTypeClass,
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

/** Issues found so far, plus the per-kind tally the summary reports. */
interface IssueLog {
  issues: ValidationIssue[];
  issuesByKind: Record<string, number>;
}

/** Record one issue and count it, so the summary is built in a single pass. */
function pushIssue(params: { log: IssueLog; issue: ValidationIssue }): void {
  const { log, issue } = params;
  log.issues.push(issue);
  log.issuesByKind[issue.kind] = (log.issuesByKind[issue.kind] ?? 0) + 1;
}

/** Names in `from` that `other` lacks, in `from`'s order. */
function missingFrom(params: { from: readonly string[]; other: readonly string[] }): string[] {
  const other = new Set(params.other);
  return params.from.filter((name) => !other.has(name));
}

function emptyOverapplyTally(): PiiOverapplyByKind {
  return { temporal: 0, boolean: 0, enum: 0, numericFk: 0 };
}

type OverapplyKind = "pii_on_temporal" | "pii_on_boolean" | "pii_on_enum" | "pii_on_numeric_fk";

interface OverapplyRule {
  kind: OverapplyKind;
  /** Tally bucket in `PiiOverapplyByKind`. */
  bucket: keyof PiiOverapplyByKind;
  /** What the column's native type is, for the message. */
  reasonHint: string;
  /** Extra condition on the column name; the rule always applies when absent. */
  appliesTo?: (field: string) => boolean;
}

/**
 * The over-apply heuristic per native-type class. Classes without an entry
 * (text, other) can hold PII on their own and are never flagged.
 */
const OVERAPPLY_RULES: Partial<Record<NativeTypeClass, OverapplyRule>> = {
  temporal: {
    kind: "pii_on_temporal",
    bucket: "temporal",
    reasonHint: "a bare date/time value (not free text)",
  },
  boolean: { kind: "pii_on_boolean", bucket: "boolean", reasonHint: "a boolean flag" },
  enum: {
    kind: "pii_on_enum",
    bucket: "enum",
    reasonHint: "a fixed-set enum (not free text)",
  },
  numeric: {
    kind: "pii_on_numeric_fk",
    bucket: "numericFk",
    reasonHint: "a numeric foreign-key id (does not identify a person on its own)",
    appliesTo: looksLikeForeignKeyName,
  },
};

/** The over-apply rule that flags `field`, if any. */
function overapplyRuleFor(params: {
  field: string;
  nativeType: string;
}): OverapplyRule | undefined {
  const rule = OVERAPPLY_RULES[classifyNativeType(params.nativeType)];
  if (!rule) return undefined;
  return rule.appliesTo === undefined || rule.appliesTo(params.field) ? rule : undefined;
}

/** Emit a single `pii_on_*` warn and update both per-table and global counters. */
function pushOverApply(params: {
  log: IssueLog;
  tallies: readonly PiiOverapplyByKind[];
  rule: OverapplyRule;
  table: string;
  field: string;
  nativeType: string;
}): void {
  const { log, tallies, rule, table, field, nativeType } = params;
  pushIssue({
    log,
    issue: {
      kind: rule.kind,
      table,
      field,
      severity: "warn",
      message: `Field '${field}' is flagged pii: true but nativeType '${nativeType}' is ${rule.reasonHint} — re-check whether the value alone identifies a person`,
    },
  });
  for (const tally of tallies) tally[rule.bucket] += 1;
}

/** Fields present on one side only: missing_field / orphan_field errors. */
function checkFieldCoverage(params: {
  log: IssueLog;
  table: string;
  metadataNames: readonly string[];
  selectableNames: readonly string[];
}): void {
  const { log, table, metadataNames, selectableNames } = params;
  for (const field of missingFrom({ from: metadataNames, other: selectableNames })) {
    pushIssue({
      log,
      issue: {
        kind: "missing_field",
        table,
        field,
        severity: "error",
        message: `Field '${field}' exists in metadata but not in selectableFields`,
      },
    });
  }
  for (const field of missingFrom({ from: selectableNames, other: metadataNames })) {
    pushIssue({
      log,
      issue: {
        kind: "orphan_field",
        table,
        field,
        severity: "error",
        message: `Field '${field}' is in selectableFields but missing from metadata`,
      },
    });
  }
}

/**
 * The fields an operator explicitly marked redacted: `select: "redact"` or
 * legacy `pii: true`. A field that is only redacted by the secure-by-default
 * fallback is skipped — an unmigrated config shouldn't get 30 warns.
 */
function explicitlyRedactedFields(
  selectableFields: SelectableFieldsMap[string],
): [string, SelectableFieldsMap[string]["fields"][string]][] {
  return Object.entries(selectableFields.fields).filter(
    ([, info]) =>
      getEffectivePolicy(info) === "redact" && (info.select === "redact" || info.pii === true),
  );
}

interface CheckTablePairParams {
  log: IssueLog;
  table: string;
  metadataFields: Record<string, GenericFieldMetadata>;
  selectableFields: SelectableFieldsMap[string];
  globalOverapply: PiiOverapplyByKind;
}

interface CheckTablePairResult {
  fieldsChecked: number;
  piiMarkedCount: number;
  /** Highest per-kind over-apply count observed within this table. */
  maxPerTableOverapply: number;
}

/**
 * Redact-policy lint + over-apply pass over one table. Every explicitly
 * redacted field counts as pii-marked, needs a note, and is checked against
 * the over-apply heuristic when metadata knows its native type (a field
 * missing from metadata is already an orphan_field; one without a native
 * type gives the heuristic nothing to go on).
 */
function checkRedactedFields(params: CheckTablePairParams): CheckTablePairResult {
  const { log, table, metadataFields, selectableFields, globalOverapply } = params;
  const perTableOverapply = emptyOverapplyTally();
  const redacted = explicitlyRedactedFields(selectableFields);
  for (const [field, info] of redacted) {
    if (!getEffectiveNote(info)) {
      pushIssue({
        log,
        issue: {
          kind: "missing_pii_reason",
          table,
          field,
          severity: "warn",
          message: `Field '${field}' has select: "redact" (or legacy pii: true) but no note/piiReason`,
        },
      });
    }
    const nativeType = metadataFields[field]?.nativeType;
    if (nativeType === undefined) continue;
    const rule = overapplyRuleFor({ field, nativeType });
    if (!rule) continue;
    pushOverApply({
      log,
      tallies: [globalOverapply, perTableOverapply],
      rule,
      table,
      field,
      nativeType,
    });
  }
  return {
    fieldsChecked: Object.keys(selectableFields.fields).length,
    piiMarkedCount: redacted.length,
    maxPerTableOverapply: Math.max(...Object.values(perTableOverapply)),
  };
}

function checkTablePair(params: CheckTablePairParams): CheckTablePairResult {
  checkFieldCoverage({
    log: params.log,
    table: params.table,
    metadataNames: Object.keys(params.metadataFields),
    selectableNames: Object.keys(params.selectableFields.fields),
  });
  return checkRedactedFields(params);
}

function exceedsGlobalThreshold(globalOverapply: PiiOverapplyByKind): boolean {
  return Object.values(globalOverapply).some((n) => n >= GLOBAL_OVERAPPLY_THRESHOLD);
}

/** Tables present on one side only: missing_table / orphan_table errors. */
function checkTableCoverage(params: {
  log: IssueLog;
  metadataTables: readonly string[];
  selectableTables: readonly string[];
}): void {
  const { log, metadataTables, selectableTables } = params;
  for (const table of missingFrom({ from: metadataTables, other: selectableTables })) {
    pushIssue({
      log,
      issue: {
        kind: "missing_table",
        table,
        severity: "error",
        message: `Table '${table}' exists in metadata but not in selectableFields`,
      },
    });
  }
  for (const table of missingFrom({ from: selectableTables, other: metadataTables })) {
    pushIssue({
      log,
      issue: {
        kind: "orphan_table",
        table,
        severity: "error",
        message: `Table '${table}' is in selectableFields but missing from metadata`,
      },
    });
  }
}

export function validateSelectableFieldsCoverage(
  params: ValidateSelectableFieldsCoverageParams,
): ValidateSelectableFieldsCoverageResult {
  const { metadata, selectableFields } = params;
  const log: IssueLog = { issues: [], issuesByKind: {} };
  const globalOverapply = emptyOverapplyTally();

  checkTableCoverage({
    log,
    metadataTables: Object.keys(metadata),
    selectableTables: Object.keys(selectableFields),
  });

  const pairs = Object.entries(metadata).flatMap(([table, meta]) => {
    const sel = selectableFields[table];
    return sel ? [{ table, meta, sel }] : [];
  });
  const results = pairs.map(({ table, meta, sel }) =>
    checkTablePair({
      log,
      table,
      metadataFields: meta.fields,
      selectableFields: sel,
      globalOverapply,
    }),
  );

  const likelyOverApplication =
    results.some((r) => r.maxPerTableOverapply >= PER_TABLE_OVERAPPLY_THRESHOLD) ||
    exceedsGlobalThreshold(globalOverapply);

  return {
    issues: log.issues,
    summary: {
      tablesChecked: pairs.length,
      fieldsChecked: results.reduce((sum, r) => sum + r.fieldsChecked, 0),
      piiMarkedCount: results.reduce((sum, r) => sum + r.piiMarkedCount, 0),
      issuesByKind: log.issuesByKind,
      piiOverapplyByKind: globalOverapply,
      likelyOverApplication,
    },
  };
}
