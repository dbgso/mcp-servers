# Whitelist abstraction design

Rationale for the shared whitelist / reader / gate primitives. This is
the "why" companion to `docs/specs/whitelist-abstraction.md`; the spec
declares what the surface IS, this document explains what problem the
shape solves and which alternatives were rejected.

Interface signatures are canonical in
`packages/shared/primitives/src/interfaces/*.ts`. Nothing here
duplicates them — pointers only.

---

## Purpose

Every safe-read tool in the repository (`shared/db-ops`, `shared/aws/dynamodb`,
`shared/aws/cloudwatch`, `shared/aws/s3`, `shared/redis`) grew its own
copy of the same pattern: "list containers → describe fields →
whitelist-guarded read". Five near-parallel implementations diverged
on:

- container-gate error shape (`notWhitelisted` / `NOT_ALLOWED` /
  `bucketNotWhitelisted` / `KEY_NOT_ALLOWED`)
- projection type (`string[]` vs DDB `ProjectionExpression` vs CW
  merged sets)
- redact set provenance (unbranded `Set<string>` freely constructed vs
  guard-derived)
- limit clamping (private const per op vs shared policy)
- container resolver semantics (identity vs longest-prefix vs
  logical↔physical reverse-map)

The abstraction collapses those five copies onto one set of composable
primitives so adding a new adapter is "implement the traits the
backend actually supports; ops that need absent traits refuse at
registry-load time".

---

## Design decisions

### Extraction landscape

Each subsection below covers one concern. The design decision for
each — should it live in shared code, or stay per-product?

| Concern (policy the design takes) | Shared? | Reason (causal justification) |
|---|---|---|
| Every backend expresses its read surface as a whitelist-gated read; the shared layer defines that shape once. | Yes | Because five near-identical gate implementations were drifting apart on error shape, projection type, and redact provenance, extracting the shape once removes the drift surface. |
| Runtime endpoint and credential material are resolved through one URI-scheme chain (`env` → `secret://` → `ssm://`), owned outside the primitives. | Yes | Because per-backend sourcing conventions force a bootstrap doc per adapter, one resolver collapses that to a single lookup path shared by all. |
| Human-in-the-loop approval sits between op invocation and reader dispatch, orthogonal to the backend. | Yes | Because the gate protects against blast-radius, not backend semantics, sharing it keeps DDB writes and CW-Insights queries on the same review path. |
| Codegen is a producer of whitelist configuration; its pipeline shape is uniform, only the introspection API and sample-retry axis vary. | Yes | Because the emit invariants (secure-by-default, no sample-value embedding, never-overwrite) must never drift, keeping them in one shell forecloses the per-backend re-implementation bug class. |
| Each MCP server binds its whitelist to its own binary at compile time; the wiring path is intentionally not shared. | **No** | Because runtime-injectable whitelists open a path for the LLM to widen its own scope, moving whitelist selection off the code-review threshold would be a security regression. |
| Third-party HTTP APIs (LINE Messaging, New Relic NerdGraph) sit outside the primitives layer. | **No** | Because these calls have no container / field taxonomy to gate against, forcing them through `FieldWhitelist` / `ContainerAccess` would require every trait to be stubbed with no capability gain. |
| Runtime schema-inspection tools compose through the same primitives as data-read tools. | Yes | Because schema metadata is itself a structured read with a whitelist-shaped output, the existing `Introspector` / `Inspector` traits already carry the surface. |
| Legacy CloudWatch `LogSchemaConfig` is retired rather than absorbed. | **No** | Because CW v2 already replaces the shape, migrating the legacy config would spend effort on a surface the primitives layer already deprecates. |

The shared-or-not verdict lives here. The subsections below explain
each concern's shape and rationale — they do not repeat the verdict.
Current implementation status (already extracted, retrofit pending,
deprecated, etc.) is a code-tree question, not a design question, and
is deliberately not tracked in this table.

### Backend capability is declared per-trait, not per-fat-interface

Every tool implements exactly one Core (or two, for Redis — see
below). Each optional trait is implemented only if the backend has a
capability that maps to it. Ops reach traits through
`ctx.trait(name)`; missing traits throw `UnsupportedOperationError`
carrying the trait + tool name.

Rejected alternatives:

- **Pattern A — one fat interface with every method** — forces
  every tool to stub trait methods that make no sense for its backend
  (S3 with `readByEq`). Stubs rot; callers cannot tell what is
  supported without reading the impl.
- **Pattern B — n concrete adapters with no shared interface** — is
  the status quo we are dismantling. Each op reinvents the gate.

Pattern C keeps the base contract narrow (Core + `Whitelist`
supertype) and pushes capability declaration into traits so a
tool's ctx type is exactly the surface it can honour.

### Naming: `Whitelist` as the canonical noun

`SelectableFieldsConfig` / `CwLogSchemaConfig` / `LogGroupConfig` /
`SelectableBucketsConfig` / `RedisSelectableFieldsConfig` all named
the same thing five ways. The rename to `Whitelist`
(`FieldWhitelistConfig`, `PatternWhitelistConfig`) is consumer-facing;
adapters re-export their historical name as an alias so existing tool
code compiles.

`Whitelist` was chosen over `Allowlist` because the noun already had
industry traction in the DB world (MySQL / Postgres ACL literature),
and switching mid-refactor to `Allowlist` would have caused a
gratuitous rename in every op file for no capability gain.

### Field-addressable and opaque-payload backends do not share a Core

DB, DDB, CW, Redis-hash all have per-field ACL semantics. S3 and
Redis-scalar have opaque payloads with no addressable fields. Forcing
S3 to satisfy `FieldWhitelist` (with `getSelectableFields` returning
`["*"]` or similar) would make the shared type useless — every op
that consumed a `FieldWhitelist` would have to branch on "is this an
opaque tool".

Instead, both Cores extend the shared `Whitelist` supertype (container
enumeration + `hasContainer`) so container-level ops (`list_containers`)
compose identically. Field-shaped ops depend on `FieldWhitelist`;
opaque-payload ops depend on `ContainerAccess`. A single adapter MAY
declare both — Redis is the reference: hash patterns register
`FieldWhitelist`, scalar patterns register `ContainerAccess`, both hang
off one ctx.

### `ContainerResolver.resolve` returns `null` on no-match

The alternatives were `undefined` and `throw`. `null` was chosen
because:

- `undefined` collides with "identifier is optional" call-sites
  (`resolve(args.container)` where `args.container` may itself be
  undefined) — the return would become
  `TContainer | undefined | undefined`, indistinguishable from
  "input was missing" vs "input was present but did not resolve".
- `throw` forces every op to wrap the call in try/catch to convert
  no-match into a `notWhitelisted` response. Explicit null-check
  reads cleaner and lets ops emit the exact error shape they want.

### Query-planner capabilities are opt-in traits, not forced Reader methods

Explain is a query-planner capability. DB has it (via `EXPLAIN`), CW
has a degenerate variant (`validate_query` 1-second probe), DDB / S3 /
Redis do not. Making explain a `Reader` method would push adapters to
provide `explainRead*` methods that immediately throw.

As an optional trait, ops that want a cost-preview compose it
explicitly (`ctx.trait("explainer").explain(query)`); ops that do not
never touch it. The `find_by_date_range` op is the reference — it
runs Explain, checks the estimate against a threshold, and refuses
without confirmation if the plan exceeds the cap. On tools without
`Explainer` that op simply is not registered.

### `dry_run` stays in ctx, branched inline by op factories

Options considered:

1. Wrap every `Reader` in a `DryRunReader` that returns
   `{ dryRun: true, built }` — reader-side indirection.
2. Add `dryRun?: boolean` to every reader input — parameter bloat.
3. Keep `dryRun` on the ctx; op factories check `ctx.dryRun` between
   query construction and reader invocation.

Option 3 was chosen. The dry-run branch is a two-line inline check
(`if (ctx.dryRun) return respond.dryRun({ built })`), the Reader
interface stays orthogonal to policy, and the op factory keeps full
control over what the "built" payload looks like per adapter.

### Multi-container search is a superset trait, not a base capability

`MultiContainerSearchReader` extends `SearchReader` rather than being
folded into it. Single-container adapters (DDB, DB) never accept
`containers: TContainer[]`; only CW Insights supports "one query, N
log groups". Op factories that need multi-container semantics depend
on the extended trait; single-container ops depend on the base. The
`extends` relation lets CW satisfy both from one implementation.

### Scope: which tools the primitives layer targets

A "primitives-fit" tool is a **whitelist-gated read over a data store
with a field or key taxonomy**. The whitelist declares which
containers (tables / log groups / buckets / key patterns) are visible
and, per container, which fields are selectable. Every op factory
composes the same sequence: container gate → key / query shape gate
→ project selectable fields → read → optional redact → respond.

Concrete in-scope backends: MySQL / Postgres (via Prisma),
DynamoDB, CloudWatch Logs, S3 objects, Redis (hash + scalar
patterns). The out-of-scope entries (HTTP RPC APIs, build-time
codegen, legacy CW `LogSchemaConfig`) and one boundary case
(runtime schema-inspection tools, which fit the shape but haven't
been retrofitted) are named with their causal justifications in the
Extraction landscape table above.

Rejected alternatives:

- **Adding an `HttpApiSurface` Core to accommodate HTTP APIs**.
  Rejected because the primitives layer earns its keep from the
  "whitelist gates a read" shape. A `HttpApiSurface` would degrade
  to "call endpoint E with params P", which is a plain function
  call — no gate composes, no redact composes, no `dry_run` composes.
  Forcing HTTP APIs through primitives would push adapters to stub
  every trait; the shape gains nothing and consumers pay the tax.
- **Bundling codegen into shared primitives as a "MetadataGenerator"
  primitive**. Rejected because codegen runs at developer machine
  boot / CI, not at request time; it depends on live database
  connections, DMMF parsers, and file-system emit — a very different
  I/O profile from primitives, which are request-time pure /
  side-effect-scoped-to-reads. Cross-linking the two would drag
  build-time dependencies (Prisma CLI, drizzle-kit) into the runtime
  primitives package.

### Runtime config sourcing is uniform across backends

Every backend adapter (RDB / DDB / CW / S3 / Redis) needs runtime
endpoint + credential material. The tool package sources it uniformly
through the same three-tier chain:

- **env vars** for local development and simple deployments
  (`DATABASE_URL`, `REDIS_URL`, `AWS_REGION`, ...)
- **AWS Secrets Manager** via a `secret://` URI-scheme resolver in
  `shared/secrets` — the env var holds an ARN, the resolver fetches
  the plaintext value at boot
- **AWS Systems Manager Parameter Store** via an `ssm://` URI-scheme
  resolver (same package) — same pattern for non-secret runtime
  parameters

The primitives layer knows nothing about any of this. Adapters accept
plain constructor arguments (`{ url, tls, region, ... }`) and the tool
package resolves URIs to plain values before calling the constructor.
Adding a Redis endpoint to a product that does not yet have one is
therefore (1) declare the pattern whitelist (human-reviewed) and
(2) point `REDIS_URL` (or a `secret://` URI) at the endpoint — no
new sourcing plumbing per product.

Rejected alternatives:

- **Per-backend sourcing conventions** (Redis reads `REDIS_URL`,
  DDB reads a JSON blob from S3, ...) — every new backend would
  need its own bootstrap doc. Uniform URI-scheme resolution collapses
  this to one lookup path shared by all adapters.
- **A shared "Config" primitive** — pushing sourcing into shared
  would couple the primitives layer to AWS SDKs. The URI resolver in
  `shared/secrets` is a helper, not a primitive; adapters never see
  it.

### Whitelist is compiled into each MCP server, never runtime-injected

Shared primitives accept the whitelist as a plain function parameter
(`createRedisTools({ selectableFields, ... })`,
`createDatabaseTools({ selectableFields, ... })`, etc). This is
what makes the primitives layer testable and reusable across
adapters. It also opens a path the product layer has to close:
nothing in the shared API stops a caller from passing an
attacker-chosen whitelist.

The product-side rule is therefore: **each MCP server hardcodes its
whitelist inside its own package, and the hardcoded value is the only
one ever wired into the tool registration.** No env var, no MCP
client request field, no runtime config file, no config-service
lookup — the whitelist is compile-time bound to the shipped binary,
and updating it requires a code change that goes through PR review.

The threat model this closes: the LLM (or a malicious MCP client)
being able to influence which fields are `expose`. If the whitelist
were reachable through any input the LLM can shape — a tool argument,
an env var the LLM can suggest changing, a config file the LLM can
propose editing — the LLM could ask itself to widen its own access
before performing a read. Compile-time binding removes that avenue.

Concretely for each product:

- The whitelist config file (`selectable-fields.ts`,
  `redis-selectable-patterns.ts`, `cw-log-schemas.ts`, ...) lives
  under the product's `src/domains/<backend>/`.
- The product's `src/domains/<backend>/index.ts` imports it as a
  static value and passes it as the `selectableFields` argument to
  the shared factory at module load. There is no code path that
  substitutes a different value at request time.
- The whitelist config value is `const`; there is no setter, no
  mutation API, no `updateWhitelist` tool, no "reload" endpoint.

Rejected alternatives:

- **Whitelist as a tool argument** — LLM writes its own scope. Full
  self-escalation.
- **Whitelist loaded from a mutable config service at runtime** —
  moves the security posture to whichever service holds the config,
  and adds an operational failure mode (config service down / drift
  between servers). Human PR review is a stronger, simpler gate.
- **Whitelist derived from env vars** — env is easier to change than
  code, which is exactly why it is the wrong surface. The whitelist
  needs the code-review threshold specifically because it decides
  what the LLM can see.
- **Reusing one binary across products with different whitelists
  via runtime config** — reject the packaging convenience because it
  creates a single-package-with-many-postures shape that inevitably
  drifts. Each product shipping its own binary with its own
  compiled-in whitelist keeps the "what does this MCP server expose"
  question answerable by reading one file in one repo.

### Whitelist source-of-truth is codegen from live introspection

**Why codegen at all**: the whitelist is a type-parameterised value —
each entry (`{ users: { select: { email: "expose" } } }`) has to name
an actual container and field the live datastore exposes. If the
type parameter (`TableName`, `FieldNames<T>`) is hand-written, it can
drift silently from the live schema: a typo (`emaill: "expose"`)
compiles but denotes nothing, a renamed column (`email` →
`email_address`) leaves the old key hanging as dead config, a newly
added column never surfaces to the human curator. Codegen closes
those drift paths by anchoring the type parameter to a live-introspection
output — a typo becomes a TS build error, a rename becomes a git
diff, a new column becomes a `redact` skeleton entry a human has to
consciously flip or leave alone. Everything else this decision talks
about (skeleton emit, developer flow, secure-by-default) is
downstream of that core reason.

Whitelist config files (`selectable-fields.ts`, `redis-selectable-patterns.ts`,
`cw-log-schemas.ts`, ...) are therefore never hand-authored from
scratch. Every backend ships a codegen runner in its shared package
that introspects the live datastore and emits both artifacts the
primitives layer consumes:

- A **metadata module** with typed container / field / pattern names,
  used as the type parameter to the whitelist config. This is what
  makes a typo or a stale column-name fail at TypeScript compile time
  instead of at runtime.
- A **skeleton whitelist** where every field defaults to `redact` or
  `exclude`. `expose` is never emitted; a human flipping a field to
  `expose` is the review point.

Codegen sources per backend:

- RDB (MySQL / Postgres): `shared/db-codegen` — Prisma DMMF extraction
  and `information_schema` introspection.
- DynamoDB: `shared/aws/dynamodb/codegen` — DescribeTable +
  sample-item type inference.
- CloudWatch Logs: `shared/aws/cloudwatch/codegen` — log group
  discovery + Insights sample-query field inference.
- Redis: `shared/redis/codegen` — SCAN pattern sampling +
  hash-field inspection.

The developer flow is uniform:

1. `pnpm --filter <product> run generate:live-<backend>` runs the
   codegen against the live datastore pointed at by the product's env
   file.
2. The runner overwrites the metadata module unconditionally and
   emits the skeleton whitelist for any newly discovered container.
   Existing whitelist decisions are preserved — regeneration adds
   entries, never overwrites `expose` decisions a human has already
   made.
3. Git diff surfaces the change. The human reviews new
   containers / fields, flips `redact` to `expose` per field only
   where PII posture and business need allow it, and lands the
   change through the same PR review path as any other code change.
4. Merge = whitelist expansion.

**Secure-by-default is the invariant** — a codegen output that lands
un-reviewed is safe by construction (everything `redact`; no leak
possible), but it also delivers no user-visible capability until a
human curates. That mismatch is the deliberate coercion that keeps
whitelist decisions on the human review path rather than the
"whatever the schema happens to expose" path.

Rejected alternatives:

- **Hand-written whitelists**. Silent divergence from the live
  schema: a renamed column becomes an unreachable `expose` entry, a
  new column defaults to unexposed (safe) but also invisible to the
  LLM, and neither state surfaces in CI. Codegen-driven whitelists
  turn every schema drift into a diff.
- **Runtime introspection at server boot** (query the live schema at
  startup, apply defaults, expose everything not marked private).
  Rejected because "expose everything by default" inverts the
  secure-by-default invariant, and because prod servers now depend on
  a live introspection call succeeding before they can serve — a
  boot-time coupling to the datastore that isn't there today.
- **Emitting `expose` defaults in the skeleton**. Rejected because
  the skeleton then IS the whitelist, and codegen becomes the point
  where PII posture is decided rather than the point where the
  decision surface is presented. Human curation must be the flip
  from `redact` to `expose`, not the flip back the other way.
- **Codegen inside the primitives package**. Rejected for the same
  reasons codegen is out of scope of the primitives layer (see the
  scope decision above): different I/O profile, different lifecycle,
  different dependency graph. The producer/consumer split at the
  emitted metadata module is the boundary.

### The codegen shell owns invariants; backends supply strategies

Because the emit-side invariants — secure-by-default (`expose`
structurally unemittable), never embed sample values, never overwrite
an existing SF file — must not drift across backends, the emit steps
of every codegen live in one shell rather than in each backend's own
runner. Backends only supply what genuinely varies: the introspection
API call, the enumeration output shape, the filename slug, and
optional pre-inference transforms (Redis's key-to-pattern collapse
today).

Rejected alternatives:

- **Keep the shell but let each backend re-implement metadata /
  skeleton emit.** Every per-backend re-implementation is a place
  the invariants can be forgotten — the sample-value PII leak that
  surfaced in CW was exactly this class of bug.
- **Codegen inside the primitives package.** Codegen runs at
  developer machine boot or in CI, not at request time; folding it
  into `shared/primitives` would drag build-time dependencies
  (Prisma CLI, drizzle-kit) into the runtime primitives package.
  The producer/consumer split at the emitted metadata module is the
  boundary.

### Sampling is a per-backend strategy, not a forced pipeline step

Because RDB has no sample phase (Prisma DMMF is authoritative for
its schema) while CW / DDB / Redis do, sampling is exposed as an
optional strategy the backend plugs in, not a pipeline stage every
backend has to satisfy. The retry axis is likewise per-backend:
CW widens the time window, Redis expands the SCAN COUNT, DDB grows
the sample-item count.

Rejected alternative:

- **Force every backend into a single "sample" shape.** Rejected
  because RDB's schema is already exact — inserting a no-op sample
  step in RDB would be dead code and would suggest the shell needs
  every backend to sample, hiding the actual axis of variation.

### Trait-not-implemented: build-time test + runtime throw

Two overlapping guards:

- **Build-time** — per-tool test iterates the registry and asserts
  each op's declared `requires.extras` maps to a trait the ctx
  factory constructs. Catches "op registered without its trait" at CI.
- **Runtime** — `ctx.trait(name)` throws `UnsupportedOperationError`.
  Belt-and-braces last line if the build-time test is skipped or the
  registry is populated dynamically.

Two layers because CI can be bypassed and runtime is the real
enforcement point; the build-time test exists so trait mismatches
surface at the fastest feedback loop.

### Error responses need caller context; every respond callback receives the original args

Every `respond` callback on every op factory receives the caller's
original `args` object as `input.args`. This lets tools whose gate
errors need context beyond the standard `{ container, available }`
payload — e.g. the Redis error taxonomy that distinguishes
"whitelist has no matching pattern for THIS key" from "the WHITELIST
itself is empty" and needs the original key back to render the
message — reconstruct the exact response byte-identically.

Rejected alternatives:

- **Per-factory ad-hoc extra params** (e.g. adding a `key` argument
  only to `createContainerReadOp.respond.notWhitelisted`). Rejected
  because every tool has some field the factory can't anticipate;
  standardising on the full `args` object makes the contract
  uniform and forward-compatible with new tool args.
- **A closure captured at factory-config time** (tool builds its
  respond mapper by closing over the args). Rejected because the
  respond mapper is a static config value, not per-call — the
  factory can't hand it fresh args by closure.

Backward compatibility is a design goal: callbacks that don't
destructure `args` compile unchanged under TypeScript structural
typing, so existing consumer registries (RDB / CW / DDB / S3) need
no code change to keep working.

### The pre-gate escape hatch is opt-in per factory, not a universal composition point

Container-derivation-heavy tools (Redis: caller supplies a full
`key` / `MATCH` string, factory needs a `container` = pattern that
overlaps) sometimes need to short-circuit BEFORE
`extractContainer` runs — either because derivation itself can fail
in a way the gate error can't express, or because the tool wants a
richer error taxonomy than
`respond.notWhitelisted({ args, container, available })` provides
even with `args` present.

The hook lives only on `createContainerReadOp` and
`createEnumerateOp`, not on every factory. Rationale: the container
factories are the only ones that face this pattern in practice
(S3 + Redis's scalar / SCAN ops), and adding an escape hatch to
every factory would (1) proliferate config surface for zero
demonstrated need on field-shaped factories and (2) suggest the
pre-gate hook is a normal composition point rather than an
adapter-specific opt-in. Field-shaped factories (`createFindByPkOp`
etc) can add the same hook later if a concrete tool needs it.

### One adapter, two Cores: Redis's split lives on the same connection

Redis has both hash-typed and scalar-typed patterns on the same
connection. Making one adapter class implement both Cores lets the
codegen emit one metadata module and the runtime dispatch on pattern
type. The alternative (two Redis adapters — `redis-hash` and
`redis-scalar` — sharing a client) doubled the surface area for zero
capability gain.

---

## Composition intent

### Op factories own the flow

An op factory (`createFindByPkOp`, `createSearchOp`, ...) is the only
place where primitives are wired into a runnable operation. This is
deliberate: the flow (container-gate → key-shape → project → read →
redact → respond) is invariant across adapters, so it belongs in a
shared factory. Adapters supply the ctx; the factory supplies the
sequence.

Adapters do NOT re-implement the sequence. If an adapter needs
adapter-specific logic (DDB's `mapKeyAllowlist` post-filter), that
logic lives inside the adapter's `Redactor` implementation, invoked by
the shared factory as part of the standard sequence. Adapter-specific
extensions never leak upward into shared interfaces.

### Tool-side config vs helper split

The rule: if the piece is **caller-facing wiring** (which ops to
register, which containers are visible, what the tool's name is) it
lives in the tool package. If the piece is **the sequence itself**
(read → redact → respond) it lives in shared primitives.

Examples:

- `inventoryProjector(name) → summary` in `list_containers` is
  tool-specific (each backend has different summary fields) — lives
  in the tool.
- `mergeWhitelistAcrossContainers` (intersection / union / missing)
  is a pure computation over `FieldWhitelist` — lives in shared
  helpers.
- `createStandardRespond` is a labels-parameterised factory that
  produces the standard error bundle — lives in shared helpers, tool
  supplies its `containerNoun` / `fieldNoun` labels.

---

## Op → primitive decomposition (canonical patterns)

The composition shapes below explain why each op decomposes the way it
does. The literal step lists are in the spec (§8).

### `find_by_pk` shape

Container gate → key-shape gate → project selectable fields → point
read → optional redact. The key-shape gate is deliberately op-local
(not a shared primitive) — a PK is DB-specific (composite PK, natural
PK, DDB partition+sort), and pushing it into shared would force every
adapter into one PK model. The shared factory drives the sequence;
the adapter supplies the PK-shape validator via ctx.

### `find_by_fk` shape

Container gate → FK metadata lookup → reduces to `find_by_index`. FK
is a DB metadata concept; the op is not a new primitive, it is a
composition of `find_by_index` with a metadata accessor
(`findForeignKey`). DDB reuses the shape via GSI lookup; the semantic
"resolve a name to a search entrypoint" is identical.

### `find_by_date_range` with Explain gate

Range read plus `Explainer.explain` before invoking the reader. The
Explain step is the reason `Explainer` is an optional trait — it
composes cleanly with `RangeReader` when present and is omitted when
absent, with no forced degenerate impl.

### Search with `QueryGuard`

Container gate (multi via `mergeWhitelistAcrossContainers`) → guard →
optional `dry_run` short-circuit → search → redact. The
`QueryGuard.guard()` return produces the `GuardedRedactSet` that the
`Redactor` consumes directly. The brand on the set is the whole
reason the compose is safe: a caller cannot construct a
`GuardedRedactSet` without going through a `QueryGuard`, so the
"guard runs before redact" invariant is enforced at compile time.

### Opaque-payload point read

`ContainerAccess.hasContainer` + `ContainerAccess.isItemAllowed` +
`PointReader.readOne({ fields: [] })` + optional redact. The empty
`fields` list is a deliberate signal — the payload is opaque, no
projection applies. Every opaque-payload op re-uses this exact shape.

### Enumerate

`ContainerAccess.hasContainer` + prefix / pattern overlap pre-check +
`Enumerator.enumerate` + per-item `isItemAllowed` post-filter. The
double gate (pre-filter overlap check + post-filter per-item) is
because backend enumerators (S3 `ListObjects` prefix, Redis `SCAN
MATCH`) are advisory — they narrow the candidate set but do not
enforce the whitelist. The post-filter is the actual gate.

### Engine-inspect (`show_processlist` shape)

`Inspector.getProcessList` (with method-existence check) →
`withCappedRows` → per-field sanitiser. `Inspector` methods are all
optional on the interface because different engines expose different
sub-capabilities (MySQL processlist has no DDB equivalent). The
method-existence check drives the same `UnsupportedOperationError`
path as trait absence.

---

## Anti-goals (what the shared surface deliberately excludes)

Each entry names something we chose NOT to add, and why.

1. **No format presets in shared** (`LogFormat = "pino" | "python" |
   "waf"`). Rejected because product-specific parsing is not a
   primitive — if a product declares `msg` as a field, that IS the
   input. Presets would push shared into the business of knowing
   every log format the org uses.

2. **No product-specific logic in shared** (`Whitelist.getProductTableName`).
   Rejected because it makes the shared layer coupled to one product's
   naming. Product wiring composes primitives; the wiring lives in
   the product's tool package.

3. **No hardcoded field names**. `@timestamp`, `@message`,
   `payload.userId` are CW-adapter concerns and live in that
   adapter's `CW_BUILTIN_IDENTIFIERS` constant. Rejected in shared
   because "which field names are built in" is per-backend, not
   universal.

4. **No engine-specific concessions on base interfaces**. DDB's
   `ProjectionExpression`, Redis glob patterns, MySQL `SHOW CREATE
   TABLE` all stay as adapter subtypes of the generic primitives.
   Rejected on base because pulling one engine's quirks into the
   shared shape would force the other four to accommodate them.

5. **No implicit approval / dry-run assumptions on primitives**.
   Primitives never sniff `ctx.dryRun`; op factories branch on it
   explicitly. Rejected because a primitive that changes behaviour
   on a policy flag is un-testable in isolation.

6. **No mixed responsibilities in a single primitive**. `Whitelist`
   does not redact; `Redactor` does not gate; `Projection` does not
   limit. Rejected because each primitive is a compose target — a
   two-headed primitive collapses two compose points into one
   opaque surface.

7. **No trait leakage**. If `RedisWhitelist` has `matchKeyToPattern`,
   that method is only on `RedisWhitelist`, never as an optional
   method on the base `Whitelist`. Rejected because "optional method
   on the base type" is indistinguishable from Pattern A (see design
   decisions) — every consumer would have to check for its presence.

8. **No stateful primitives**. `Whitelist`, `Redactor`, `Projection`,
   `LimitPolicy`, `QueryGuard` are pure. Only `Reader`, `Explainer`,
   `Inspector`, `Introspector` touch I/O. Rejected stateful because
   pure primitives are trivially testable and safe to share across
   requests; stateful ones need lifetime management the shared layer
   should not own.

9. **No secret defaults**. Every `LimitPolicy` exposes `defaultLimit`
   and `maxLimit`. Every `QueryGuard` exposes its excluded / redacted
   sets. Rejected hidden defaults because a caller inspecting the
   op's `detail` should see every constraint that will apply — no
   surprises at runtime.

10. **No argument sniffing on primitives**. `readOne(x)` never
    switches to `readMany` if it sees an array. Rejected polymorphic
    dispatch because one-method-one-behaviour composes cleanly;
    smart dispatch does not.

11. **No unbranded redact sets**. `Redactor.redactMany`'s
    `redactFieldNames` is `GuardedRedactSet`, not
    `ReadonlySet<string>`. Rejected the plain set because a plain
    set can be fabricated at any call-site, bypassing the guard. The
    brand makes the guard→redact chain a compile-time invariant.

---

## Meta: what makes a decision belong here vs the spec

The golden test for placement between this file and the spec:

- If removing the sentence deletes information about **what
  interface consumers see**, it belongs in the spec.
- If removing the sentence deletes information about **why the
  shape is this shape** (a decision, a trade-off, a rejected
  alternative), it belongs here.

Test: read a paragraph in isolation. Does it teach someone to USE the
interface? → spec. Does it teach someone to CHANGE the interface? →
design.

---

## Pointer

Paired spec: `docs/specs/whitelist-abstraction.md`. Canonical
interface signatures: `packages/shared/primitives/src/interfaces/*.ts`.
