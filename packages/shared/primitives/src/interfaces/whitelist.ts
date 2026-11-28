/**
 * Whitelist primitives — the container/field ACL surface every tool
 * shares. Two Core variants (`FieldWhitelist`, `ContainerAccess`);
 * every tool implements one (or both, in Redis's split-personality
 * case).
 *
 * See docs/specs/whitelist-abstraction.md (Core interfaces).
 */

export type FieldVisibility = "expose" | "redact" | "exclude";

export interface FieldPolicy {
  /** Default `"redact"` (secure-by-default). */
  select?: FieldVisibility;
  /** Free-form justification for reviewers. */
  note?: string;
}

export interface FieldWhitelistContainer<TField extends string = string> {
  description?: string;
  fields: Readonly<Record<TField, FieldPolicy>>;
}

/**
 * Shared supertype. Every tool implements the operations here — the
 * only mandatory Core surface. Field / item ACL is added by
 * `FieldWhitelist` or `ContainerAccess` on top.
 */
export interface Whitelist<TContainer extends string = string> {
  /** Alphabetical list of container names in the whitelist. */
  listContainers(): readonly TContainer[];
  /** Type-narrowing gate; false → op refuses. */
  hasContainer(name: string): name is TContainer;
}

/**
 * Per-field policy Core. Used by DB (`TableConfig`), CW v2
 * (`CwLogGroupConfig`), DDB (via adapter from `allowed[]`), Redis
 * hash-typed patterns.
 */
export interface FieldWhitelist<
  TContainer extends string = string,
  TField extends string = string,
> extends Whitelist<TContainer> {
  getContainer(name: TContainer): FieldWhitelistContainer<TField> | undefined;

  /** Fields where policy != `"exclude"`. Feeds `Projection`. */
  getSelectableFields(container: TContainer): readonly TField[];

  /** Effective policy for one field (default `"redact"`). */
  getFieldPolicy(input: { container: TContainer; field: string }): FieldVisibility;

  /**
   * True when the container is whitelisted but every field is
   * `"exclude"`. Maps to the closed-by-default refusal currently
   * duplicated across db-ops (get_by_pk / get_by_fk / get_by_index /
   * get_by_date_range / json_search).
   */
  isEmpty(container: TContainer): boolean;
}

export interface ContainerLimits {
  maxItemSize?: number;
  maxItemCount?: number;
}

/**
 * Prefix / pattern ACL over opaque payloads (S3 objects, Redis scalar
 * values). No per-field policy because the payload has no addressable
 * fields.
 */
export interface ContainerAccess<TContainer extends string = string> extends Whitelist<TContainer> {
  /**
   * Whether the concrete item (S3 key, Redis raw key) is accessible
   * under `container`. Includes path-traversal defence.
   */
  isItemAllowed(input: { container: TContainer; item: string }): boolean;

  getContainerLimits(container: TContainer): ContainerLimits;
}
