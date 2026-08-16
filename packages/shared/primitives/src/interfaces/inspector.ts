/**
 * Inspector primitive — engine-state introspection (PROCESSLIST,
 * stats, index usage, engine INFO, etc). Every adapter surfaces its
 * own set of inspection methods; this interface is a very-loose
 * upper bound that any of them satisfies structurally.
 *
 * Concrete adapters extend / narrow this with their own typed method
 * set (see `InspectionDataSource` in shared/db-ops). The `invoke`
 * config of `createInspectionOp` knows the concrete method to call,
 * so the type on this base interface stays permissive.
 *
 * See docs/specs/whitelist-abstraction.md §4.8.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InspectorMethod = (...args: any[]) => Promise<unknown>;

export type Inspector = Readonly<Record<string, InspectorMethod | undefined>>;
