/**
 * Build the codegen describe/execute MCP tool pair.
 *
 * - Resolves the connection URL through `resolveTunneledUrl` (transparent
 *   SSH-bastion tunnelling when `DBGEN_BASTION_*` env vars are set).
 * - Picks an introspector from the URL scheme via `pickIntrospector`.
 * - Operations layer never sees DB credentials directly.
 */
import { createDescribeExecuteHandlers, type ToolHandler } from "mcp-shared";
import { bastionConfigFromEnv, resolveTunneledUrl, ssmConfigFromEnv, type BastionConfig, type TunnelSpec } from "mcp-shared/tunnel";
import type { Introspector } from "./introspect/types.js";
import {
  pickIntrospector,
  type PickIntrospectorParams,
} from "./introspect/pick.js";
import type { CodegenOperationContext } from "./operations/types.js";
import { codegenRegistry } from "./operations/registry.js";

const DEFAULT_TOOL_PREFIX = "dbgen";
const DEFAULT_ENV_PREFIX = "DBGEN";

const DEFAULT_PREAMBLE = [
  "All operations are read-only. Reads the connected DB's catalog tables and",
  "produces JSON previews for `metadata.json` / `selectable-fields.json`,",
  "and a coverage validator for the latter.",
  "",
  "## Recommended workflow",
  "",
  "1. **Discover schemas**: `list_schemas` to find the namespace your tables live in.",
  "2. **List tables**: `list_tables` against the chosen schema.",
  "3. **Inspect**: `introspect_table` for one, `introspect_all` for a whole schema.",
  "4. **Generate**: `preview_metadata_json` + `preview_selectable_fields_json`.",
  "   Save each output to disk; the read MCP loads these at start-up. The",
  "   selectable-fields template ships **secure-by-default** — every field",
  "   starts at `{ \"select\": \"redact\" }` (value masked). The reviewer flips",
  "   each field to the right policy per the rules below.",
  "5. **Choose the visibility policy** (mandatory before exposing the read MCP).",
  "   Three policies exist:",
  "     - `\"expose\"` — value returned as-is. Use only after auditing the",
  "       column with the four-axis PII test below.",
  "     - `\"redact\"` (default) — value replaced with `[REDACTED]` in tool",
  "       output. Safe for fields whose existence callers need to see but",
  "       whose value is sensitive (PII, secrets, internal identifiers).",
  "     - `\"exclude\"` — column rejected from queries entirely. Use for",
  "       fields that should never reach a caller at all.",
  "   For every field, **always cross-reference `metadata.json`'s `nativeType`",
  "   for the column** before deciding — column names alone are ambiguous",
  "   (e.g. `affiliation` may be `varchar(255)` free text in one table and",
  "   `enum(...)` categorical in another). The four-axis judgement is a",
  "   function of *content*, not name:",
  "     - **Identifies a person**: real name, address, email, phone,",
  "       employee/login id, government id, account id used for sign-in.",
  "     - **Joins to a person**: a surrogate id becomes PII only when it sits",
  "       in the same record as one of the identifiers above (e.g. `users.email`",
  "       is PII; `orders.user_id` is not PII by itself).",
  "     - **Reaches a person**: emergency contact, push tokens, device ids,",
  "       mailing address, social handle.",
  "     - **Sensitive attribute**: medical, gender, birthdate, salary, race,",
  "       religion, exact location, biometric, free-text comment that may",
  "       contain any of the above.",
  "   Type cheat-sheet (use to inform the four-axis decision, not as a",
  "   substitute):",
  "     - `enum(...)` / `tinyint(1)` / boolean / numeric ids — categorical or",
  "       numeric. Not free text. Often safe to `\"expose\"` unless the value",
  "       itself encodes a sensitive attribute (medical, gender, etc.).",
  "     - `text` / `longtext` / `json` / `varchar(>=255)` — may contain user-",
  "       entered free text. Default `\"redact\"` is usually correct.",
  "     - `timestamp` / `datetime` / `date` alone — usually safe to `\"expose\"`",
  "       (a `date` birthdate is the rare exception → keep `\"redact\"`).",
  "   Format: `{ \"select\": \"expose\" | \"redact\" | \"exclude\", \"note\": \"<short",
  "   reason in the project's natural language>\" }`. The legacy",
  "   `{ \"pii\": true, \"piiReason\": \"...\" }` shape is still accepted (read",
  "   as `select: \"redact\"`) for back-compat — migrate at your own pace.",
  "   When uncertain, **leave the default `\"redact\"`** — false negatives",
  "   (a sensitive field accidentally exposed) are the dangerous case.",
  "6. **Validate**: `validate_selectable_fields` cross-checks the saved JSON",
  "   against the live schema. Re-run after every edit; fix every",
  "   `missing_pii_reason` and field-level drift before shipping.",
  "   **If the validator emits any `pii_on_temporal` / `pii_on_boolean` /",
  "   `pii_on_enum` / `pii_on_numeric_fk` warns, re-judge each flagged field**",
  "   — that pattern is the AI failure mode of marking everything on a PII-",
  "   heavy table as redact (e.g. `created_at` flagged). Verify the value",
  "   alone identifies a person before keeping `select: \"redact\"` — if it",
  "   doesn't, switch to `\"expose\"`. `summary.likelyOverApplication: true`",
  "   means several warns of the same kind cluster — treat as a strong",
  "   signal to re-do that slice.",
  "",
  "## Tips for large schemas",
  "",
  "- Parallelize PII marking by spawning one sub-agent per ~10 tables, grouped",
  "  by table-name prefix. Each agent reads `introspect_table` for its slice",
  "  and writes flags only for that slice. Merge into the master JSON after",
  "  all agents finish, then run `validate_selectable_fields` once at the end.",
  "- Empty / audit / log tables can usually skip PII flagging, but keep their",
  "  field lists in selectable-fields so the validator does not flag drift.",
].join("\n");

export interface CreateCodegenToolsConfig {
  /** Connection URL (e.g. `postgres://user:pass@host:5432/db`). */
  getUrl: () => string;
  /**
   * Optional tunnel-spec provider (SSH bastion **or** AWS SSM port forward).
   * When omitted, the factory falls back to env-driven defaults:
   * `bastionConfigFromEnv(envPrefix)` first, then `ssmConfigFromEnv(envPrefix)`.
   * Pass `() => null` to disable tunneling entirely.
   *
   * Both sources set → throws (operator must pick one).
   */
  getTunnel?: () => TunnelSpec | null;
  /**
   * Deprecated alias for {@link getTunnel}'s SSH-bastion case. Retained for
   * backward compatibility — when `getTunnel` is unset and `getBastion`
   * returns a config, the factory wraps it as `{ bastion: ... }`.
   */
  getBastion?: () => BastionConfig | null;
  /** Override the env-var prefix used for tunnel config (default: "DBGEN"). */
  envPrefix?: string;
  toolPrefix?: string;
  describeDescription?: string;
  executeDescription?: string;
  preamble?: string;
  /** Test seam: override the introspector picker. Defaults to `pickIntrospector`. */
  pickIntrospector?: (params: PickIntrospectorParams) => Promise<Introspector>;
}

export function createCodegenTools(config: CreateCodegenToolsConfig): ToolHandler[] {
  const envPrefix = config.envPrefix ?? DEFAULT_ENV_PREFIX;
  const picker = config.pickIntrospector ?? pickIntrospector;
  const [describe, execute] = createDescribeExecuteHandlers<CodegenOperationContext>({
    prefix: config.toolPrefix ?? DEFAULT_TOOL_PREFIX,
    registry: codegenRegistry,
    listTitle: "DB Codegen Operations",
    preamble: config.preamble ?? DEFAULT_PREAMBLE,
    ...(config.describeDescription && { describeDescription: config.describeDescription }),
    ...(config.executeDescription && { executeDescription: config.executeDescription }),
    buildContext: async () => {
      const rawUrl = config.getUrl();
      if (!rawUrl) {
        throw new Error(
          `Missing DB connection URL — set ${envPrefix}_URL or pass getUrl()`,
        );
      }
      const tunnel = resolveTunnelSpec({ envPrefix, config });
      const { url } = await resolveTunneledUrl({
        url: rawUrl,
        ...(tunnel && { tunnel }),
      });
      // Tunnel handle (if any) is owned by `resolveTunneledUrl` — its
      // ChildProcess is bound to the parent process lifetime, so we don't
      // need to track it per call.
      const introspector = await picker({ url });
      return { introspector };
    },
  });
  return [describe, execute];
}

/**
 * Pick a tunnel spec from `config` overrides + env defaults.
 *
 * Precedence (first match wins, mutually exclusive):
 *   1. `config.getTunnel()` — fully explicit override
 *   2. `config.getBastion()` — backward-compat alias for SSH bastion
 *   3. `bastionConfigFromEnv(envPrefix)` — `<PREFIX>_BASTION_HOST` etc.
 *   4. `ssmConfigFromEnv(envPrefix)` — `<PREFIX>_SSM_TARGET` etc.
 *
 * If both bastion env signals AND ssm env signals are set, throws.
 *
 * Exported for unit testing — every branch (override / alias / env-bastion /
 * env-ssm / mutual-exclusion / no-tunnel) is reachable from this entry point
 * without going through a real spawn.
 */
export function resolveTunnelSpec(params: {
  envPrefix: string;
  config: CreateCodegenToolsConfig;
}): TunnelSpec | null {
  const { envPrefix, config } = params;
  if (config.getTunnel) return config.getTunnel();
  if (config.getBastion) {
    const bastion = config.getBastion();
    return bastion ? { bastion } : null;
  }
  const bastion = bastionConfigFromEnv(envPrefix);
  const ssm = ssmConfigFromEnv(envPrefix);
  if (bastion && ssm) {
    throw new Error(
      `Set at most one of ${envPrefix}_BASTION_HOST or ${envPrefix}_SSM_TARGET, not both`,
    );
  }
  if (bastion) return { bastion };
  if (ssm) return { ssm };
  return null;
}
