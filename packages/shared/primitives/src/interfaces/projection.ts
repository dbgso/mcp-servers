/**
 * Projection primitive — build the server-side field selection list
 * from a FieldWhitelist. Result shape is per-tool because DDB's
 * `ProjectionExpression` and CW's multi-log-group intersection do not
 * look like a simple `string[]`.
 *
 * See docs/specs/whitelist-abstraction.md §4.1.
 */

export interface Projection<TContainer extends string, TResult = readonly string[]> {
  build(input: { container: TContainer | readonly TContainer[] }): TResult;
}
