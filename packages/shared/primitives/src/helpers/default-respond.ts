/**
 * Standard whitelist-gate response builder.
 *
 * Every op factory (createFindByPkOp / createFindByEqOp / createSearchOp /
 * ...) surfaces the same 4-6 "gate rejected" branches with essentially
 * identical error shapes:
 *
 *   notWhitelisted        - container isn't in the tool's whitelist
 *   emptyWhitelist        - container has no selectable fields
 *   fieldNotSelectable    - the requested predicate field isn't selectable
 *   guardFailed           - the QueryGuard rejected the caller's query
 *   containersMissing     - multi-search: N containers requested, K missing
 *   containerNotWhitelisted - inspect: the target container isn't selectable
 *
 * Tools currently duplicate these across every op's respond mapper
 * (~15 lines × N ops per tool). This helper produces the whole bundle
 * once per tool, keyed to the tool's noun ("Table" / "Log Group" /
 * "Bucket" ...); tools spread it into each op's respond.
 *
 * Not consumed by primitives itself — it's a *convenience for tools*,
 * whose `TResponse` type is opaque to primitives. The helper is
 * generic in TResponse and takes the tool's `jsonResponse` fn as a
 * parameter to bridge the two.
 */

export interface StandardRespondLabels {
  /**
   * Displayed noun in error messages, e.g. `"Table"` / `"Log Group"` /
   * `"Bucket"`. Should be capitalized as it appears at the start of an
   * error sentence.
   */
  containerNoun: string;

  /**
   * Displayed noun for the field-level error / gate. Defaults to `"field"`.
   * Capitalized form is derived automatically for sentence-start.
   */
  fieldNoun?: string;

  /**
   * JSON key under which the "available containers" list ships in the
   * notWhitelisted response. Defaults to `available${ContainerNoun}s`
   * (e.g. "availableTables"). Override when the tool needs a different
   * key ("availableLogGroups").
   */
  availableListKey?: string;

  /**
   * JSON key under which the "allowed fields" list ships in the
   * fieldNotSelectable response. Defaults to `"allowedFields"`.
   */
  allowedFieldsKey?: string;

  /**
   * Optional trailing sentence appended to the emptyWhitelist error
   * message. Used by tools that want to point callers at discovery ops
   * (e.g. RDB: "Row data cannot be returned. Table definition remains
   * visible via describe_table / table_stats.").
   */
  emptyWhitelistSuffix?: string;
}

export interface StandardRespond<TResponse> {
  notWhitelisted(input: { container: string; available: readonly string[] }): TResponse;
  emptyWhitelist(input: { container: string }): TResponse;
  fieldNotSelectable(input: {
    container: string;
    field: string;
    allowedFields: readonly string[];
  }): TResponse;
  guardFailed(input: { error: Error; code?: string }): TResponse;
  containersMissing(input: {
    containers: readonly string[];
    missing: readonly string[];
  }): TResponse;
  containerNotWhitelisted(input: { container: string; available: readonly string[] }): TResponse;
}

/**
 * Build the standard respond bundle. Returned object satisfies the
 * gate-response subset of every op factory's `respond` interface.
 *
 * Example:
 *   const standardRespond = createStandardRespond({
 *     jsonResponse,
 *     labels: {
 *       containerNoun: "Table",
 *       fieldNoun: "column",
 *       availableListKey: "availableTables",
 *       allowedFieldsKey: "allowedColumns",
 *     },
 *   });
 *
 *   // in each op's config:
 *   respond: {
 *     ok: (...) => ...,
 *     notFound: (...) => ...,
 *     ...standardRespond,  // covers notWhitelisted, emptyWhitelist, etc
 *   }
 */
export function createStandardRespond<TResponse>(params: {
  jsonResponse: (data: unknown) => TResponse;
  labels: StandardRespondLabels;
}): StandardRespond<TResponse> {
  const { jsonResponse, labels } = params;
  const {
    containerNoun,
    fieldNoun = "field",
    availableListKey = `available${containerNoun}s`,
    allowedFieldsKey = "allowedFields",
    emptyWhitelistSuffix,
  } = labels;

  const fieldNounCapitalized = fieldNoun.charAt(0).toUpperCase() + fieldNoun.slice(1);

  const notWhitelisted = ({
    container,
    available,
  }: {
    container: string;
    available: readonly string[];
  }): TResponse =>
    jsonResponse({
      error: `${containerNoun} '${container}' is not selectable.`,
      [availableListKey]: available,
    });

  return {
    notWhitelisted,
    emptyWhitelist: ({ container }) => {
      const base = `${containerNoun} '${container}' has no selectable ${fieldNoun}s in the whitelist.`;
      return jsonResponse({
        error: emptyWhitelistSuffix ? `${base} ${emptyWhitelistSuffix}` : base,
      });
    },
    fieldNotSelectable: ({ container, field, allowedFields }) =>
      jsonResponse({
        error: `${fieldNounCapitalized} '${field}' is not selectable on '${container}'.`,
        [allowedFieldsKey]: allowedFields,
      }),
    guardFailed: ({ error }) => jsonResponse({ error: error.message }),
    containersMissing: ({ containers, missing }) =>
      jsonResponse({
        error: `${containerNoun}s not selectable: ${missing.join(", ")}`,
        requested: containers,
        missing,
      }),
    containerNotWhitelisted: notWhitelisted,
  };
}
