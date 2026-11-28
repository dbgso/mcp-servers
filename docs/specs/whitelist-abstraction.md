# Whitelist abstraction spec

The shared contract every safe-read tool adapter (`shared/db-ops`,
`shared/aws/dynamodb`, `shared/aws/cloudwatch`, `shared/aws/s3`,
`shared/redis`) satisfies. Interface signatures are canonical in
`packages/shared/primitives/src/interfaces/*.ts`; this document
enumerates the surface, states the behaviour contract in RFC 2119
terms, and points at the TS file for each shape.

Paired design: `docs/designs/whitelist-abstraction.md`.

---

## Purpose

`mcp-shared-primitives` exposes the interfaces, helpers,
and op factories that every backend adapter (RDB, DynamoDB, CloudWatch,
S3, Redis) implements. A tool package declares which traits it can
honour by shape-satisfying the ctx type; ops registered against a ctx
that lacks a required trait throw `UnsupportedOperationError` at call
time.

---

## Terms

- **Container** — top-level named resource: table / log group /
  bucket / Redis pattern.
- **Field** — caller-facing name inside a container: column /
  attribute / JSON path / Redis hash field. Opaque-payload backends
  (S3, Redis-scalar) have no fields.
- **Whitelist** — config declaring which containers exist and which
  of their fields have which visibility.
- **Trait** — one optional interface an adapter may implement. Each
  trait scopes to one capability (read one item, run a query, produce
  a cost estimate).
- **Core** — the mandatory interface every adapter implements. Two
  variants (`FieldWhitelist`, `ContainerAccess`); an adapter declares
  one or both.
- **Op** — a runnable operation produced by a shared factory
  (`createFindByPkOp`, `createSearchOp`, ...) parameterised on a ctx.

---

## Interface surface

Names, one-line descriptions, canonical file pointers. Full signatures
are in the TS files — this list exists so a reader can locate a
symbol without opening the source.

### Core interfaces

Source: `packages/shared/primitives/src/interfaces/whitelist.ts`.

- `Whitelist<TContainer>` — shared supertype. Container enumeration
  and `hasContainer` gate.
- `FieldVisibility` — `"expose" | "redact" | "exclude"`.
- `FieldPolicy` — per-field policy record with optional `note`.
- `FieldWhitelistContainer<TField>` — container-level policy bundle
  keyed by field name.
- `FieldWhitelist<TContainer, TField>` — per-field Core. Extends
  `Whitelist`. Used by DB, DynamoDB, CloudWatch, Redis-hash.
- `ContainerLimits` — `maxItemSize` / `maxItemCount`.
- `ContainerAccess<TContainer>` — opaque-payload Core. Extends
  `Whitelist`. Used by S3, Redis-scalar.

### Optional traits

- `Projection<TContainer, TResult>` —
  `packages/shared/primitives/src/interfaces/projection.ts`.
  Server-side field selection list. `TResult` is per-adapter (string
  array for RDB, DDB expression object, CW allowed/excluded/redacted
  triple).
- `Redactor<TContainer, TRecord>` —
  `packages/shared/primitives/src/interfaces/redactor.ts`. Response
  post-filter. Consumes `GuardedRedactSet` produced by `QueryGuard`.
- `GuardedRedactSet` (also in `redactor.ts`) — branded
  `ReadonlySet<string>` produced only by a `QueryGuard`; enforces the
  guard→redact chain at compile time.
- `LimitPolicy` —
  `packages/shared/primitives/src/interfaces/limit-policy.ts`. Clamp
  policy over a caller-supplied `limit`.
- `defaultClamp` —
  `packages/shared/primitives/src/helpers/default-clamp.ts`. Factory
  returning a `LimitPolicy` (defined in `limit-policy.ts`) with the
  default clamp semantics.
- `ContainerResolver<TContainer>` —
  `packages/shared/primitives/src/interfaces/container-resolver.ts`.
  Concrete identifier → whitelist container name.
- `QueryGuardWhitelist`, `QueryGuardResult<TSafeQuery>`,
  `QueryGuard<TInput, TSafeQuery>`, `asGuardedRedactSet` —
  `packages/shared/primitives/src/interfaces/query-guard.ts`.
  Parse-guard-rewrite pipeline for caller-supplied query languages.
- `ExplainResult`, `Explainer<TQuery>` —
  `packages/shared/primitives/src/interfaces/explainer.ts`. Cost
  preview without executing.
- `PointReader<TContainer, TKey, TRecord>`,
  `EqReader<TContainer, TRecord>`,
  `RangeReader<TContainer, TBound, TRecord>`,
  `SearchResult<TRecord>`,
  `SearchReader<TContainer, TSafeQuery, TRecord>`,
  `MultiContainerSearchReader<TContainer, TSafeQuery, TRecord>`,
  `EnumeratePage<TIdentifier>`,
  `Enumerator<TContainer, TIdentifier>` —
  `packages/shared/primitives/src/interfaces/readers.ts`. Reader
  traits, split by predicate shape.
- `JsonPathReader<TContainer, TRecord>` —
  `packages/shared/primitives/src/interfaces/json-path-reader.ts`.
- `Inspector`, `InspectorMethod` —
  `packages/shared/primitives/src/interfaces/inspector.ts`. Engine-state
  inspection. Every method optional.
- `Introspector<TContainerInfo, TRawMetadata>` —
  `packages/shared/primitives/src/interfaces/introspector.ts`.
  Codegen-side live-catalog reader.

### Context and operation

Source:
`packages/shared/primitives/src/interfaces/{context,operation}.ts`.

- `ToolContext<TCore, TReader, TExtras>` — how traits reach ops.
  `ctx.whitelist` (Core), `ctx.reader` (reader traits), `ctx.limit`
  (`LimitPolicy`), optional `ctx.dryRun`, `ctx.trait(name)` accessor.
- `Operation<TArgs, TCtx, TResponse>` — op signature (`id`,
  `argsSchema`, `execute`, `requires`).
- `OperationTraits` — declared `reader` and `extras` requirements.

### Helpers

- `withCappedRows` —
  `packages/shared/primitives/src/helpers/*` (see `helpers/index.ts`).
  Bounded row cap for inspection ops.
- `mergeWhitelistAcrossContainers` —
  `packages/shared/primitives/src/helpers/merge-whitelist.ts`.
  Compute effective whitelist across a set of containers.
- `createStandardRespond`, `StandardRespond<TResponse>`,
  `StandardRespondLabels` —
  `packages/shared/primitives/src/helpers/default-respond.ts`. Shared
  gate-rejected response bundle.

### Runtime errors

- `UnsupportedOperationError` — `packages/shared/primitives/src/errors.ts`.
  Thrown by ctx trait accessor when a trait is not declared.

### Op factories

Source: `packages/shared/primitives/src/ops/*.ts`.

- `createFindByPkOp` — `find-by-pk.ts`.
- `createFindByEqOp` — `find-by-eq.ts`.
- `createFindByRangeOp` — `find-by-range.ts`.
- `createSearchOp` — `search.ts`.
- `createMultiSearchOp` — `multi-search.ts`.
- `createInspectOp` — `inspect.ts`.
- `createExplainOp` — `explain.ts`.
- `createJsonSearchOp` — `json-search.ts`.
- `createContainerReadOp` — `container-read.ts`. `ContainerAccess` +
  `PointReader` (opaque payload). Used by S3 `get_object`, Redis
  scalar `get`.
- `createEnumerateOp` — `enumerate.ts`. `ContainerAccess` +
  `Enumerator` (identifier listing). Used by S3 `list_objects`, Redis
  `SCAN`.

---

## Behaviour rules

Container gate (`Whitelist`):

- `listContainers` MUST return container names in alphabetical order.
- `hasContainer(name)` MUST narrow the type of `name` to `TContainer`
  and MUST return `false` when the name is not in the whitelist.
- Any op MUST refuse (return the container-gate error, not throw) when
  `hasContainer` returns `false` for its input container.

Field policy (`FieldWhitelist`):

- `getFieldPolicy({ container, field })` MUST return `"exclude"` when
  the container is not in the whitelist.
- `getFieldPolicy` MUST default to `"redact"` for a field that is in
  the container but has no explicit `select` value.
- `getSelectableFields(container)` MUST return only fields whose
  effective policy is not `"exclude"`.
- `isEmpty(container)` MUST return `true` iff `container` is
  whitelisted AND every field's effective policy is `"exclude"`.
- Ops that read from a `FieldWhitelist` MUST refuse (empty-whitelist
  error) when `isEmpty(container)` returns `true`.

Item ACL (`ContainerAccess`):

- `isItemAllowed({ container, item })` MUST return `false` when
  `container` is not whitelisted.
- `isItemAllowed` MUST reject path-traversal fragments (`..`
  segments, absolute-path prefixes) regardless of container config.

Limit clamp (`LimitPolicy`):

- `clamp(caller)` MUST return `min(defaultLimit, maxLimit)` when
  `caller` is `undefined`, `NaN`, or non-finite.
- `clamp(caller)` MUST return `1` when `caller` is `<= 0`.
- `clamp(caller)` MUST return `maxLimit` when `caller > maxLimit`.
- `clamp` MUST return a value in `[1, maxLimit]` for every input.

Resolver (`ContainerResolver`):

- `resolve(identifier)` MUST return `null` when no whitelisted
  container matches; MUST NOT return `undefined` and MUST NOT throw
  for a no-match input.
- When multiple containers could match, `resolve` SHOULD return the
  most-specific match (longest literal prefix); ties broken
  alphabetically.

Query guard (`QueryGuard`):

- `guard(input)` MUST reject any query that references a field whose
  effective policy is `"exclude"`.
- `guard(input)` MUST populate `redactFieldNames` with every field
  referenced by the query whose policy is `"redact"`.
- `redactFieldNames` MUST be a `GuardedRedactSet` produced via
  `asGuardedRedactSet`. Callers MUST NOT fabricate an unbranded set.
- `enforcedLimit` MUST equal `limit.clamp(callerLimit)`.

Redactor (`Redactor`):

- `redactMany` MUST accept only `GuardedRedactSet` (or `undefined`)
  for `redactFieldNames`; the type system enforces this.
- When `redactFieldNames` is `undefined`, `redactMany` MUST derive the
  redact set from the container's `FieldWhitelist` and apply the same
  filter as when a set is supplied.

Readers:

- `PointReader.readOne` MUST return `null` when the key is not
  present; MUST NOT throw for a missing key.
- `SearchReader.runSearch` MUST NOT return more than `limit` items in
  `items`.
- `MultiContainerSearchReader.runMultiSearch` MUST apply the merged
  whitelist (`mergeWhitelistAcrossContainers`) to filter the response
  before returning.
- `Enumerator.enumerate` MUST return at most `limit` items in
  `items`. `nextCursor` MUST be set iff more items are available.

Explainer (`Explainer`):

- `explain(query)` MUST NOT execute the query against production data.
  For adapters where a genuine planner is unavailable, `estimatedRows`
  and `totalCost` MUST be `null` and `planSummary` MUST describe the
  degenerate behaviour.

Trait access (`ToolContext`):

- `ctx.trait(name)` MUST throw `UnsupportedOperationError` (carrying
  `tool` + `trait` fields) when the named trait was not declared on
  the ctx type.
- `ctx.trait(name)` MUST NOT return `undefined` on success.

Op wiring (`Operation`):

- Every op MUST declare its trait dependencies in `requires`.
- A registry MUST reject registration of an op whose `requires`
  reference traits the ctx factory does not construct (build-time
  test).

Op factory `respond` callbacks:

- Every `respond` callback on every op factory
  (`createFindByPkOp` / `createFindByEqOp` / `createFindByRangeOp` /
  `createJsonSearchOp` / `createSearchOp` / `createMultiSearchOp` /
  `createContainerReadOp` / `createEnumerateOp` /
  `createInspectionOp` / `createExplainOp`) SHALL receive the
  original `args` object as `input.args`. Callbacks that do not
  destructure `args` compile unchanged (TypeScript structural
  typing).
- `createContainerReadOp` and `createEnumerateOp` SHOULD support an
  optional `preContainerGate` config hook of shape
  `(input: { args, ctx }) => TResponse | null | Promise<...>` that
  runs BEFORE `extractContainer` and the container gate. Returning
  a `TResponse` short-circuits the op; returning `null` continues to
  the standard flow. Container-derivation-heavy tools (Redis
  key→pattern, Redis SCAN MATCH → pattern overlap) use this hook
  when the standard gate error cannot carry enough context on its
  own.
- Other factories (`createFindByPkOp`, `createFindByEqOp`, ...) do
  not expose `preContainerGate` because their tools derive
  containers by direct extraction from typed args, and the standard
  `respond.notWhitelisted({ args, container, available })` payload
  already carries every input needed to reconstruct any error
  shape.

Introspector (`Introspector`):

- `introspectContainer` MUST return only key / path / type
  information; MUST NOT include row values.

---

## Trait / capability matrix

Rows = trait. Columns = adapter. `yes` = implements, `partial` =
degenerate implementation, `—` = does not implement (op factories
that need the trait are not registered).

| Trait | DB | DDB | CW v2 | S3 | Redis |
|---|---|---|---|---|---|
| Core: `FieldWhitelist` | yes | yes | yes | — | yes (hash patterns) |
| Core: `ContainerAccess` | — | — | — | yes | yes (scalar patterns) |
| `Projection` | yes (`string[]`) | yes (DDB expr) | yes (intersection) | — | — |
| `Redactor` | yes | yes | yes | — | yes |
| `LimitPolicy` | yes | yes | yes | partial (Enumerator only) | yes |
| `ContainerResolver` | — (identity) | yes (logical↔physical) | — (identity) | — | yes (glob) |
| `QueryGuard` | yes (`assertSelectOnly`) | partial (auto-escape only) | yes (reference impl) | — | partial (SCAN MATCH check) |
| `Explainer` | yes | — | partial (validate_query probe) | — | — |
| `PointReader` | yes | yes | — | yes | yes |
| `EqReader` | yes | — | — | — | — |
| `RangeReader` | yes (Date) | — | — | — | yes (int index) |
| `SearchReader` | — | yes | yes | — | — |
| `MultiContainerSearchReader` | — | — | yes | — | — |
| `Enumerator` | — | — | — | yes | yes (SCAN) |
| `Inspector` | yes | — | — | — | — |
| `Introspector` | yes | yes | yes | — | yes |

---

## I/O examples

### `createFindByPkOp` (DB, container = `users`)

Input:

```json
{
  "table": "users",
  "pk": { "id": 42 }
}
```

Output (container gated, projected, redacted):

```json
{
  "ok": true,
  "row": {
    "id": 42,
    "email": "[REDACTED]",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```

`email` is `"redact"`; `password_hash` is `"exclude"` and MUST NOT
appear in output. `id`, `created_at` are `"expose"`.

### `createSearchOp` (CW v2, single log group)

Input:

```json
{
  "logGroup": "/app/api",
  "query": "fields @timestamp, @message, payload.userId | limit 10"
}
```

Output:

```json
{
  "ok": true,
  "items": [
    { "@timestamp": "2025-06-01T00:00:00Z", "@message": "...", "payload.userId": "[REDACTED]" }
  ],
  "meta": { "nextToken": null }
}
```

`payload.userId` policy is `"redact"`; `QueryGuard.guard()` produced
the `GuardedRedactSet` consumed here.

### `createFindByPkOp` on empty whitelist

Input: `{ "table": "audit_events", "pk": { "id": 1 } }` where
`audit_events` is whitelisted but every field is `"exclude"`.

Output (empty-whitelist error, per behaviour rules):

```json
{
  "ok": false,
  "error": {
    "code": "EMPTY_WHITELIST",
    "message": "Table \"audit_events\" is whitelisted but no fields are selectable.",
    "table": "audit_events"
  }
}
```

### `ctx.trait("explainer")` on a tool without Explainer

Runtime: throws `UnsupportedOperationError` with
`{ tool: "s3", trait: "explainer" }`. The op that consumed the trait
is expected to have been rejected at registry-load time; runtime is
the last line.

---

## Pointer

Paired design: `docs/designs/whitelist-abstraction.md`. Canonical
interface signatures: `packages/shared/primitives/src/interfaces/*.ts`.
