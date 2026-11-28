/**
 * Introspector primitive — codegen-side "read the live catalog / sample
 * data" capability. Emits key/path/type metadata for a container;
 * NEVER values (this is the value-secrecy invariant that motivated
 * the whole refactor).
 *
 * See docs/specs/whitelist-abstraction.md §4.9.
 */

export interface Introspector<TContainerInfo, TRawMetadata> {
  /**
   * `scope?` covers db-codegen's `schema` argument; other tools pass
   * `undefined`.
   */
  listContainers(scope?: string): Promise<readonly TContainerInfo[]>;

  introspectContainer(input: { scope?: string; name: string }): Promise<TRawMetadata>;

  close(): Promise<void>;
}
