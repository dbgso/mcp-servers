/**
 * ContainerResolver primitive — turn a concrete caller identifier
 * into the whitelist container it belongs to. Only needed when
 * identifier ≠ container name.
 *
 * See docs/specs/whitelist-abstraction.md §4.4.
 */

export interface ContainerResolver<TContainer extends string> {
  /**
   * Returns the matched container, or `null` on no match. Never
   * returns `undefined` (§1 design decision).
   *
   * Reference implementations:
   * - Redis glob match with longest-literal-prefix tiebreak
   *   (`redis/src/access-control/selectable-fields.ts:matchKeyToPattern`)
   * - DDB logical↔physical reverse map
   *   (`aws/src/access-control/selectable-fields.ts:findLogicalName`)
   */
  resolve(identifier: string): TContainer | null;
}
