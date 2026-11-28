/**
 * What a claim of each kind has to look like: the fields it carries and the
 * kinds it has to cite.
 *
 * This table is the whole definition of "a correct claim". Nothing reads the
 * text of a field to decide whether it belongs; a claim is correct when it has
 * the fields of its kind and cites claims of the kinds its kind allows. That is
 * what makes the answer mechanical -- and why a principle has no field for a
 * condition: an exception to a principle has nowhere to be written.
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const FieldRuleSchema = z.object({
  name: z.string().min(1),
  /** When present, the only values the field may take. */
  values: z.array(z.string()).optional(),
});

const RefRuleSchema = z.object({
  kind: z.string().min(1),
  min: z.number().int().nonnegative(),
  /** Absent means no upper bound. */
  max: z.number().int().positive().optional(),
});

const KindRuleSchema = z.object({
  kind: z.string().regex(/^[A-Z][A-Z0-9]*$/, "a kind is upper-case letters and digits"),
  description: z.string(),
  fields: z.array(FieldRuleSchema),
  refs: z.array(RefRuleSchema),
  /** A claim of this kind is unused until a claim of this kind cites it. */
  coveredBy: z.string().optional(),
});

export const KindsConfigSchema = z.object({
  kinds: z.array(KindRuleSchema).min(1),
});

export type FieldRule = z.infer<typeof FieldRuleSchema>;
export type RefRule = z.infer<typeof RefRuleSchema>;
export type KindRule = z.infer<typeof KindRuleSchema>;
export type KindsConfig = z.infer<typeof KindsConfigSchema>;

/** The file under the root that replaces the default kinds. */
export const CONFIG_FILE = "claim-chain.config.yaml";

/** The kind of the record of a missing upstream decision. Not configurable. */
export const GAP_KIND = "GAP";

/**
 * req / spec / design, split so that every layer can only cite the one above.
 *
 * - DEF names a term. Principles and criteria are written in these terms, so a
 *   product name or a syntax can only reach them by being defined first.
 * - P is a principle: something that must, or must not, hold.
 * - C is a criterion that decides one principle. Exactly one: a criterion that
 *   judges two principles is two criteria.
 * - S is a behaviour of the spec, and reaches a principle only through a
 *   criterion.
 * - D is a reason, attached to what it explains.
 */
export const DEFAULT_KINDS: KindsConfig = {
  kinds: [
    {
      kind: "DEF",
      description: "A term, used by principles and criteria",
      fields: [{ name: "term" }, { name: "meaning" }],
      refs: [],
    },
    {
      kind: "P",
      description: "A principle: what must, or must not, hold",
      fields: [{ name: "modality", values: ["must", "must_not"] }, { name: "statement" }],
      refs: [{ kind: "DEF", min: 1 }],
      coveredBy: "C",
    },
    {
      kind: "C",
      description: "A criterion that decides one principle, written in defined terms",
      fields: [{ name: "condition" }],
      refs: [
        { kind: "P", min: 1, max: 1 },
        { kind: "DEF", min: 0 },
      ],
      coveredBy: "S",
    },
    {
      kind: "S",
      description: "A behaviour of the spec, meeting one or more criteria",
      fields: [{ name: "behavior" }],
      refs: [{ kind: "C", min: 1 }],
    },
    {
      kind: "D",
      description: "Why a behaviour has its shape, and what was rejected",
      fields: [{ name: "reason" }, { name: "rejected" }],
      refs: [{ kind: "S", min: 1 }],
    },
  ],
};

/** The kinds a root uses: its config file if it has one, the default otherwise. */
export async function loadKinds(root: string): Promise<KindsConfig> {
  const text = await readFile(path.join(root, CONFIG_FILE), "utf8").catch(() => null);
  if (text === null) return DEFAULT_KINDS;
  return KindsConfigSchema.parse(parseYaml(text));
}

/** Kind rules by kind name. */
export function kindIndex(config: KindsConfig): Map<string, KindRule> {
  return new Map(config.kinds.map((rule) => [rule.kind, rule]));
}
