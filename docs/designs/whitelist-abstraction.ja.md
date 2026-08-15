# Whitelist 抽象化の設計

> **注記**: `.md` (英語版) が正本。 このファイル `.ja.md` は日本語訳で参考用。
> 差分が出た場合は英語版を優先します。

共通 whitelist / reader / gate primitives の設計理由。 これは
`docs/specs/whitelist-abstraction.md` (何を提供するか宣言) と対を成す
「なぜ」の文書。 spec が「表面がどうなっているか」を述べるのに対し、
本書は「その形が解く問題」と「却下された代替案」を説明する。

Interface 定義自体は `packages/shared/primitives/src/interfaces/*.ts`
が canonical。 ここで重複させず、 pointer のみ示す。

---

## 目的

repository 内の全 safe-read tool
(`shared/db-ops`, `shared/aws/dynamodb`,
`shared/aws/cloudwatch`, `shared/aws/s3`, `shared/redis`) が
「container 列挙 → field 記述 → whitelist で gate した read」という
**同じ pattern を独自に再実装**している状態から出発している。 5 つの
near-parallel な実装は以下の点で分岐していた:

- container-gate error 形式 (`notWhitelisted` / `NOT_ALLOWED` /
  `bucketNotWhitelisted` / `KEY_NOT_ALLOWED`)
- projection 型 (`string[]` vs DDB `ProjectionExpression` vs CW
  merged set)
- redact set の由来 (unbranded `Set<string>` を任意構築 vs
  guard 由来)
- limit clamp (op ごと private const vs shared policy)
- container resolver semantics (identity vs longest-prefix vs
  logical↔physical reverse-map)

抽象化により、 これら 5 コピーを 1 組の合成可能 primitives に集約。
新 adapter 追加は「backend が実際に持つ trait だけを実装、 未実装 trait
を要求する op は registry-load 時に拒絶」となる。

---

## 設計判断

### Extraction landscape (抽出地図)

以下の各節はそれぞれ 1 つの関心事を扱う。 各関心事の設計判断 — shared
code に置くか、 per-product のままにするか:

| 関心事 (design が取る方針) | Shared 化? | 理由 (因果的正当化) |
|---|---|---|
| 各 backend の read surface は whitelist-gated read として表現され、 その shape を shared 層が一度だけ定義する。 | 対象 | 5 つのほぼ同一な gate 実装が error shape / projection 型 / redact provenance で乖離していたため、 shape を一度に抽出することで drift 面を除去できるから。 |
| Runtime endpoint / credential は `env` → `secret://` → `ssm://` の 1 本の URI-scheme chain で解決し、 primitives 外部が所有する。 | 対象 | Per-backend な sourcing 規約は adapter ごとに bootstrap doc を要求するため、 resolver を 1 つに集約することで全 adapter が同一の lookup path を共有できるから。 |
| Human-in-the-loop 承認は backend semantics ではなく op 発動と reader 呼び出しの間に挿入され、 backend に対して直交する。 | 対象 | このゲートが守るのは blast-radius であり backend semantics ではないため、 共有化することで DDB write と CW-Insights query を同じ review path に載せられるから。 |
| Codegen は whitelist 設定の producer であり、 pipeline shape は uniform、 backend 差は introspection API と sample-retry axis のみ。 | 対象 | Emit 不変条件 (secure-by-default、 sample 値の埋め込み禁止、 never-overwrite) が絶対に drift してはならないため、 1 つの shell に閉じ込めることで per-backend 再実装のバグ類を封じ込められるから。 |
| 各 MCP server は自身の binary に compile-time で whitelist を焼き込み、 この wiring path は意図的に共有しない。 | **非対象** | Runtime-injectable な whitelist は LLM が自身のスコープを広げる経路を開くため、 whitelist の選択を code-review の閾値から外すと security regression になるから。 |
| Third-party HTTP API (LINE Messaging、 New Relic NerdGraph) は primitives layer の外に置く。 | **非対象** | これらの call には gate 対象となる container / field taxonomy が存在しないため、 `FieldWhitelist` / `ContainerAccess` を通そうとすると全 trait を stub することになり capability 上の利得がゼロだから。 |
| Runtime schema-inspection 系 tool は data-read 系 tool と同じ primitives で合成する。 | 対象 | Schema metadata 自体が whitelist-shaped な出力を持つ構造化 read であるため、 既存の `Introspector` / `Inspector` trait が既にその surface を担っているから。 |
| Legacy な CloudWatch `LogSchemaConfig` は吸収せず退役させる。 | **非対象** | CW v2 が既に置換済みであるため、 legacy 設定の移行は primitives layer が既に deprecate している surface に労力を注ぐことになるから。 |

Shared 化するかしないかの判定はこの表に集約する。 以下の各節は各関心事の
shape と rationale を書き、 判定は繰り返さない。 現状の実装状態 (既に
抽出済 / retrofit 未 / deprecated 等) は code tree の話であって設計の
話でないため、 この表では意図的に扱わない。

### Backend の capability は fat interface でなく trait 単位で宣言する

全 tool は Core を厳密に 1 つ (Redis は 2 つ、 下記参照) 実装する。
optional trait は backend が対応 capability を持つ場合のみ実装。 op
から trait への到達は `ctx.trait(name)`; 未実装 trait は
`UnsupportedOperationError` を throw し、 trait 名 + tool 名を運ぶ。

却下した代替案:

- **Pattern A — 全 method を持つ fat interface** — 全 tool が
  backend にそぐわない trait method を stub する必要がある (S3 に
  `readByEq` を stub 等)。 Stub は rot し、 caller は実装を読まないと
  何が supported か判別できない。
- **Pattern B — 共有 interface 無しで n 個の adapter を並べる** — 現状
  解体中の姿。 op ごとに gate を再発明する。

Pattern C は base 契約を狭く保ち (Core + `Whitelist` supertype)、
capability 宣言を trait に押し出すことで、 tool の ctx 型はそのまま
「その tool が honour する surface」と一致する。

### 命名: `Whitelist` を canonical 名詞に

`SelectableFieldsConfig` / `CwLogSchemaConfig` / `LogGroupConfig` /
`SelectableBucketsConfig` / `RedisSelectableFieldsConfig` — 5 通りに
同じ物を命名していた。 `Whitelist` (`FieldWhitelistConfig`,
`PatternWhitelistConfig`) へのリネームは consumer 向け;
adapter は旧名を alias として re-export し既存 tool code の compile を
維持する。

`Whitelist` を選んだ理由 (対 `Allowlist`): 名詞として既に DB 界隈
(MySQL / Postgres ACL literature) で流通しており、 refactor 途中で
`Allowlist` に切り替えると全 op file で意味のない rename が生じ、
capability 上の利得がゼロ。

### Field 参照可能な backend と opaque-payload な backend は同じ Core を共有しない

DB, DDB, CW, Redis-hash は per-field ACL を持つ。 S3 と Redis-scalar は
opaque payload で addressable field を持たない。 S3 に
`FieldWhitelist` を無理やり満たさせる (`getSelectableFields` が
`["*"]` を返す 等) と、 共通型は使い物にならず — `FieldWhitelist` を
消費する全 op が「これは opaque tool か?」の branch を持つことになる。

代わりに、 両 Core とも共通 supertype `Whitelist` (container 列挙 +
`hasContainer`) を extend することで、 container レベルの op
(`list_containers`) は同一に合成できる。 field-shaped op は
`FieldWhitelist` に依存; opaque-payload op は `ContainerAccess` に
依存。 1 つの adapter が両方宣言する MAY — Redis がその reference で、
hash pattern は `FieldWhitelist`、 scalar pattern は
`ContainerAccess` を register、 両方が 1 つの ctx から下がる。

### `ContainerResolver.resolve` は no-match で `null` を返す

代替案は `undefined` と `throw` だった。 `null` を採用した理由:

- `undefined` は「identifier is optional」な呼び出し側 (`resolve(args.container)` で
  `args.container` 自体が undefined でも良い) と衝突する。 戻り値が
  `TContainer | undefined | undefined` になり、 「input が欠落」と
  「input はあったが resolve 失敗」を判別できない。
- `throw` は全 op に try/catch を強制し、 no-match を
  `notWhitelisted` response に変換する必要が生じる。 明示的な
  null-check の方が読みやすく、 op ごとに希望の error 形式を作れる。

### Query-planner 能力は opt-in trait、 Reader method に無理押ししない

Explain は query-planner の capability。 DB は持つ (`EXPLAIN` 経由)、
CW は退化した版を持つ (`validate_query` の 1 秒 probe)、 DDB / S3 /
Redis は持たない。 explain を `Reader` の method にすると、 adapter が
即 throw する `explainRead*` method を持つ羽目になる。

optional trait とすることで、 cost-preview を欲しい op が明示的に
合成し (`ctx.trait("explainer").explain(query)`)、 欲しくない op は
一切触らない。 `find_by_date_range` op が reference — Explain を走らせて
threshold と比較、 上限超過なら approve 無しでは拒絶。 `Explainer` を
持たない tool ではこの op はそもそも register されない。

### `dry_run` は ctx に留め、 op factory が inline で branch

検討した option:

1. 全 `Reader` を `DryRunReader` で wrap し
   `{ dryRun: true, built }` を返させる — reader 側 indirection。
2. 全 reader input に `dryRun?: boolean` を追加 — parameter bloat。
3. `dryRun` を ctx に留め、 op factory が query 構築後 reader 呼び出し
   前に `ctx.dryRun` を check。

Option 3 を選択。 dry-run branch は 2 行の inline check
(`if (ctx.dryRun) return respond.dryRun({ built })`) で済み、 Reader
interface は policy と直交、 op factory は adapter ごとの "built"
payload 形状を完全にコントロール可能。

### Multi-container search は base 能力でなく superset trait

`MultiContainerSearchReader` は `SearchReader` を extend する形で、
折り込み統合ではない。 単一 container の adapter (DDB, DB) は
`containers: TContainer[]` を受けない; CW Insights だけが「1 query,
N log group」を supported。 multi-container semantics が要る op
factory は extended trait に依存; 単一 container op は base に依存。
`extends` 関係により CW は 1 実装で両方を満たす。

### Scope: primitives 層が target する tool

「primitives-fit」な tool とは、 **field or key の taxonomy を持つ
data store に対する whitelist-gated read**。 whitelist は
どの container (table / log group / bucket / key pattern) が見えるか、
container ごとにどの field が select 可能かを宣言する。 全 op factory
は同じ sequence を合成: container gate → key / query 形 gate →
selectable field を projection → read → optional redact → respond。

Concrete な in-scope backend: MySQL / Postgres (Prisma 経由)、
DynamoDB、 CloudWatch Logs、 S3 object、 Redis (hash + scalar pattern)。
out-of-scope なもの (HTTP RPC API、 build-time codegen、 legacy CW
`LogSchemaConfig`) と 1 つの境界事例 (runtime schema-inspection tool、
shape に fit するが未 retrofit) は、 上の Extraction landscape 表に
因果的正当化とともに列挙してある。

却下した代替案:

- **HTTP API を収容する `HttpApiSurface` Core を追加**。 却下理由:
  primitives 層が価値を持つのは「whitelist が read を gate する」形
  だから。 `HttpApiSurface` は「endpoint E を params P で呼ぶ」に
  劣化する = 単なる関数呼び出し — gate も redact も `dry_run` も
  合成できない。 HTTP API を primitives 化すれば全 adapter が
  全 trait を stub することになり、 得るものゼロで consumer が税を払う。
- **Codegen を shared primitives に "MetadataGenerator" primitive
  として組み込む**。 却下理由: codegen は開発者 machine 起動時 / CI
  で動く、 request 時ではない; live DB 接続 / DMMF parser /
  filesystem emit に依存する — primitives (request 時 pure /
  read scope 内の side effect) とは全く別 I/O profile。 リンクさせると
  build-time 依存 (Prisma CLI, drizzle-kit) が runtime primitives
  package に流入する。

### Runtime config sourcing は backend 横断で uniform

全 backend adapter (RDB / DDB / CW / S3 / Redis) は runtime の endpoint
+ credential material を必要とする。 tool package はこれを同じ 3-tier
chain で uniform に取得する:

- **env var** — local dev / 単純 deploy 用
  (`DATABASE_URL`, `REDIS_URL`, `AWS_REGION`, ...)
- **AWS Secrets Manager** — `shared/secrets` の `secret://` URI-scheme
  resolver 経由。 env var が ARN を保持し、 resolver が boot 時に
  plaintext を fetch
- **AWS Systems Manager Parameter Store** — 同 package の `ssm://`
  URI-scheme resolver 経由。 secret 以外の runtime parameter に同 pattern

primitives 層はこの sourcing について何も知らない。 adapter は
plain な constructor 引数 (`{ url, tls, region, ... }`) を受け、
tool package が URI を plain 値に resolve してから constructor に渡す。
Redis endpoint を追加する新 product では (1) pattern whitelist を宣言
(human review 済)、 (2) `REDIS_URL` (or `secret://` URI) を endpoint
に向けるだけ — product 別 sourcing plumbing が要らない。

却下した代替案:

- **backend 別の sourcing convention** (Redis は `REDIS_URL`、 DDB は
  S3 上の JSON blob、 ...) — 新 backend ごとに bootstrap doc が必要。
  URI-scheme resolution を uniform にすればこの分岐は 1 個の lookup
  path に潰れる。
- **共通 "Config" primitive** — sourcing を shared に押し込むと
  primitives 層が AWS SDK に couple する。 `shared/secrets` の URI
  resolver は helper であって primitive ではない; adapter は helper を
  一切見ない。

### Whitelist は各 MCP server に compile-in、 runtime injection しない

共通 primitives は whitelist を plain な関数引数として受ける
(`createRedisTools({ selectableFields, ... })`,
`createDatabaseTools({ selectableFields, ... })` 等)。 これは
primitives 層を testable かつ adapter 横断で再利用可能にするための
形。 と同時に、 product 層が塞ぐ必要のある path を開いている:
共通 API 側では、 caller が attacker 選択の whitelist を渡すのを
止めるものが無い。

したがって product 側のルール: **各 MCP server は自 package 内で
whitelist を hardcode し、 その hardcoded 値だけを tool 登録に配線
する**。 env var 経由でも、 MCP client の request field 経由でも、
runtime config file 経由でも、 config-service lookup 経由でもない
— whitelist は shipped binary に compile-time bind され、 更新は
PR review を通る code 変更を要する。

これで塞がる threat model: LLM (or 悪意ある MCP client) が「どの
field が `expose` か」に影響できてしまう path。 whitelist が LLM の
shape できる入力 (tool argument、 LLM が変更提案できる env var、 LLM
が編集提案できる config file) から到達可能なら、 LLM は read を実行する
前に自分のスコープを広げるよう自分に問い合わせられる。 Compile-time
binding はこの avenue を消す。

各 product 具体には:

- Whitelist config file (`selectable-fields.ts`,
  `redis-selectable-patterns.ts`, `cw-log-schemas.ts`, ...) は
  product の `src/domains/<backend>/` 配下に置く。
- Product の `src/domains/<backend>/index.ts` はそれを **static
  import** し、 module load 時に shared factory の `selectableFields`
  引数に渡す。 request 時に別値を差し替える code path は存在しない。
- Whitelist config は `const`; setter も mutation API も
  `updateWhitelist` tool も "reload" endpoint も無い。

却下した代替案:

- **Whitelist を tool argument にする** — LLM が自分のスコープを書く。
  完全な self-escalation。
- **Runtime に mutable config service から load** — security posture が
  config を持つ service に移動し、 運用故障モードが増える (config
  service down / server 間で drift)。 Human PR review の方が
  強力で simple な gate。
- **Whitelist を env var から導出** — env は code より変更容易で、
  それがちょうど wrong surface になる理由。 whitelist は「LLM に何を
  見せるか」を決めるがゆえに code-review 閾値を必要とする。
- **1 binary を複数 product で runtime config によって使い回し** —
  packaging convenience を却下、 「1 package で多 posture」の形が
  inevitably drift するから。 各 product が自分の binary を自分の
  compile-in whitelist と一緒に ship することで「この MCP server は
  何を expose するか」の問いが「1 repo の 1 file を読む」で答えられる
  状態を保つ。

### Whitelist の source-of-truth は live introspection からの codegen

**なぜ codegen が要るか**: whitelist は型パラメータ化された値である —
各 entry (`{ users: { select: { email: "expose" } } }`) は live
datastore が実在させる container と field を名指ししないといけない。
型パラメータ (`TableName`, `FieldNames<T>`) が hand-written だと、
live schema と silent に drift できる: typo (`emaill: "expose"`) は
compile が通るが何も指さず、 rename された column (`email` →
`email_address`) は古い key を dead config として残し、 新規追加
column は human curator の視界に登らない。 codegen はこれら drift path
を、 型パラメータを live-introspection 出力に anchor することで塞ぐ
— typo は TS build error に、 rename は git diff に、 新 column は
`redact` skeleton entry になり human が意識的に flip か据え置きか
決めることになる。 本 decision で語る skeleton emit / developer flow /
secure-by-default など、 全て この core 理由の下流。

したがって whitelist config file (`selectable-fields.ts`,
`redis-selectable-patterns.ts`, `cw-log-schemas.ts`, ...) はスクラッチ
から hand-author しない。 全 backend が shared package に codegen
runner を ship し、 live datastore を introspect して primitives 層が
consume する 2 種の成果物を emit する:

- **Metadata module** — 型付きの container / field / pattern 名を
  持ち、 whitelist config への型パラメータに使う。 これが typo や
  stale column-name を runtime でなく TypeScript compile 時に fail
  させる。
- **Skeleton whitelist** — 全 field が `redact` または `exclude`
  default。 `expose` は emit しない; human が field を `expose` に
  flip するのが review point。

Backend ごとの codegen source:

- RDB (MySQL / Postgres): `shared/db-codegen` — Prisma DMMF extraction
  と `information_schema` introspection。
- DynamoDB: `shared/aws/dynamodb/codegen` — DescribeTable +
  sample-item type inference。
- CloudWatch Logs: `shared/aws/cloudwatch/codegen` — log group
  discovery + Insights sample-query field inference。
- Redis: `shared/redis/codegen` — SCAN pattern sampling +
  hash-field inspection。

Developer flow は uniform:

1. `pnpm --filter <product> run generate:live-<backend>` を叩くと、
   product の env file が指す live datastore に対して codegen が走る。
2. Runner は metadata module を無条件に上書き、 新規発見された
   container の skeleton whitelist を emit する。 既存の whitelist
   決定は preserve — regeneration は entry を add するだけで、 human
   が下した `expose` 決定を上書きしない。
3. Git diff で変更が可視化される。 human は新 container / field を
   review、 PII posture と business need が許す field だけ `redact` を
   `expose` に flip、 他の code 変更と同じ PR review path で land。
4. Merge = whitelist 拡張。

**Secure-by-default が不変条件** — codegen 出力が review 無しで land
しても construction 上 safe (全て `redact`; leak 不可能) だが、 human
が curate するまで user 可視な capability を何も提供しない。 この
ミスマッチは意図的な coercion で、 「schema が偶然 expose する物」の
path でなく「human review path」に whitelist 決定を留める。

却下した代替案:

- **Hand-written whitelist**。 live schema との silent 乖離: rename
  された column が到達不能な `expose` entry になり、 新 column は
  未 expose default (安全) だが LLM に不可視のまま、 どちらも CI に
  surface しない。 codegen-driven whitelist は全 schema drift を diff
  に変える。
- **Server boot 時の runtime introspection** (起動時に live schema を
  query、 default を適用、 private マークが無い全てを expose)。
  却下理由: 「default で全 expose」は secure-by-default 不変条件を
  反転させる、 かつ prod server が起動前に live introspection 成功に
  依存する = 今存在しない boot-time datastore coupling を発生させる。
- **Skeleton で `expose` default を emit**。 却下理由: そうすると
  skeleton がそのまま whitelist で、 codegen が PII posture を決める
  点になってしまう — 「決定 surface が提示される点」ではなくなる。
  Human curation は `redact` → `expose` の flip でないといけない、
  逆方向の flip ではダメ。
- **Primitives package 内に codegen**。 primitives 層に codegen が
  out-of-scope な理由と同じ (上の scope decision を参照): I/O profile
  違い、 lifecycle 違い、 dependency graph 違い。 producer/consumer 分離は
  emit された metadata module が境界。

### Codegen shell が不変条件を所有し、 backend は strategy を供給する

Emit 側の不変条件 — secure-by-default (`expose` は emitter 上構造的に
到達不能)、 sample 値を絶対埋め込まない、 既存 SF file を絶対上書き
しない — が backend 横断で drift してはならないため、 codegen の emit
step は 1 つの shell に集約し、 各 backend の runner には置かない。
Backend が supply するのは genuinely 変わる部分のみ: introspection API
call、 enumeration 出力 shape、 filename slug、 optional な pre-inference
transform (現状 Redis の key-to-pattern collapse のみ)。

却下した代替案:

- **Shell を持ちつつ metadata / skeleton emit は backend 別で再実装**。
  Per-backend 再実装は不変条件を忘れられる場所を生む — CW で発生した
  sample-value PII leak はまさにこの class の bug。
- **Primitives package 内に codegen**。 Codegen は開発機 boot / CI
  で走り、 request 時ではないため、 `shared/primitives` に折り込むと
  build-time 依存 (Prisma CLI、 drizzle-kit) が runtime primitives
  package に流入する。 Emit された metadata module が producer /
  consumer の境界。

### Sampling は per-backend の strategy であり、 pipeline 必須 step ではない

RDB は sample phase を持たない (Prisma DMMF が schema 上 authoritative)
一方で CW / DDB / Redis は必要とするため、 sampling は backend が plug-in
する optional な strategy として expose し、 全 backend が満たすべき
pipeline stage としない。 Retry axis も per-backend: CW は時間 window を
広げ、 Redis は SCAN COUNT を増やし、 DDB は sample-item 数を増やす。

却下した代替案:

- **全 backend を single "sample" shape に強制**。 RDB の schema は
  既に exact なため、 RDB に no-op sample step を挿入すると dead code
  になり、 shell が全 backend に sample を要求しているように見えて
  実際の axis of variation が隠れる。

### Trait 未実装: build-time test + runtime throw

overlapping な guard 2 層:

- **Build-time** — tool ごとの test が registry を iterate し、 各 op
  が宣言する `requires.extras` が ctx factory が構築する trait に mapping
  することを assert。 CI で「op が trait 無しで register された」を捕まえる。
- **Runtime** — `ctx.trait(name)` が `UnsupportedOperationError` を
  throw。 build-time test が skip されたり registry が dynamic に populate
  される場合の Belt-and-braces 最終防衛線。

2 層な理由: CI は bypass 可能なので runtime が real な enforcement
point、 build-time test は trait mismatch を最速の feedback loop で
surface するために存在。

### Error response には caller context が要る; 全 respond callback に元 args を渡す

全 op factory の全 `respond` callback は、 caller の元 args object を
`input.args` として受け取る。 gate error が標準
`{ container, available }` payload を超えた context を必要とする
tool — 例えば Redis の error taxonomy が「whitelist は THIS key と
matching する pattern を持たない」と「whitelist 自体が空」を区別する
ために元 key を必要とする — がこれで exact response を byte-identical
に再構成できる。

却下した代替案:

- **Factory 別の ad-hoc extra param** (例えば `key` argument を
  `createContainerReadOp.respond.notWhitelisted` にのみ追加)。 却下理由:
  全 tool には factory が予期しない field があるから; 完全な `args`
  object で標準化することで契約を uniform かつ将来の tool args にも
  forward-compatible にする。
- **Factory-config 時に closure に capture** (tool が args を close
  する形で respond mapper を build)。 却下理由: respond mapper は
  static config 値であって per-call ではない — factory が closure
  経由で fresh args を渡せない。

Backward compatibility が設計目標: `args` を destructure しない
callback は TypeScript structural typing で unchanged compile、
既存 consumer registry (RDB / CW / DDB / S3) は 1 行の code 変更なしに
動き続ける。

### Pre-gate の escape hatch は factory 単位の opt-in、 全 factory 共通の合成点ではない

Container-derivation-heavy な tool (Redis: caller が full な `key` /
`MATCH` string を渡し、 factory が overlap する pattern = `container`
を必要とする) は、 `extractContainer` の前に short-circuit する
必要がときにある — derivation 自体が gate error では表現できない形で
fail するか、 tool が `respond.notWhitelisted({ args, container, available })` が
`args` 付きでも provide できないより rich な error taxonomy を欲しがるから。

Hook は `createContainerReadOp` と `createEnumerateOp` のみ、 全 factory
ではない。 根拠: 実際にこの pattern に直面するのは container factory
だけ (S3 + Redis の scalar / SCAN op)、 全 factory に escape hatch を
追加すると (1) demonstrated need が無い field-shaped factory の config
surface が膨れる、 (2) pre-gate hook が通常の合成 point かのように
見え、 adapter-specific opt-in の意図が消える。 Field-shaped factory
(`createFindByPkOp` 等) は concrete tool が要求したら後で同 hook を
追加できる。

### 1 adapter に 2 Core: Redis の分割は同じ connection 上に居る

Redis は同じ connection 上に hash-typed pattern と scalar-typed
pattern を両方持つ。 1 つの adapter class に両 Core を実装させると、
codegen は 1 metadata module を emit、 runtime は pattern type で
dispatch できる。 代替案 (Redis adapter を `redis-hash` と
`redis-scalar` の 2 つに割って 1 client を share) は capability 上の
利得ゼロで surface area を倍にした。

---

## 合成の意図

### Op factory が flow を所有する

op factory (`createFindByPkOp`, `createSearchOp`, ...) が primitives を
runnable operation に組み上げる唯一の場所。 これは意図的: flow
(container-gate → key-shape → project → read → redact → respond) は
adapter 横断で不変なので、 共通 factory に置くのが妥当。 adapter は
ctx を供給、 factory が sequence を供給する。

Adapter は sequence を **再実装しない**。 adapter 特有 logic (DDB の
`mapKeyAllowlist` post-filter) が要る場合、 その logic は adapter の
`Redactor` 実装に居住し、 共通 factory から標準 sequence の一部として
invoke される。 Adapter 固有の拡張は shared interface に上向きに
leak しない。

### Tool 側 config vs helper 分離

ルール: 部品が **caller 向け wiring** (どの op を register するか、
どの container を可視化するか、 tool 名は何か) なら tool package に居住。
部品が **sequence 自体** (read → redact → respond) なら共通 primitives
に居住。

例:

- `list_containers` 内の `inventoryProjector(name) → summary` は tool
  固有 (backend ごとに summary field が違う) — tool に居住。
- `mergeWhitelistAcrossContainers` (intersection / union / missing) は
  `FieldWhitelist` 上の pure computation — 共通 helper に居住。
- `createStandardRespond` は label 引数化された factory で標準
  error bundle を produce する — 共通 helper に居住、 tool が
  `containerNoun` / `fieldNoun` label を供給。

---

## Op → primitive の分解 (canonical pattern)

下記の合成 shape は各 op の分解理由を説明する。 literal な step list
は spec (§8) にある。

### `find_by_pk` shape

Container gate → key-shape gate → selectable field projection → point
read → optional redact。 key-shape gate は意図的に op ローカル (共通
primitive にしない) — PK は DB 依存 (composite PK / natural PK / DDB
partition+sort) で、 shared に押し込むと全 adapter を 1 つの PK model
に強制する。 共通 factory が sequence を drive、 adapter は ctx で
PK-shape validator を供給する。

### `find_by_fk` shape

Container gate → FK metadata lookup → `find_by_index` に還元。 FK は
DB metadata の概念; op は新 primitive でなく、 `find_by_index` に
metadata accessor (`findForeignKey`) を組み合わせた合成物。 DDB は
GSI lookup 経由で同 shape を再利用; 「名を search entrypoint に
resolve する」意味論は同一。

### `find_by_date_range` を Explain gate 付きで

Range read の前に `Explainer.explain`。 Explain step は `Explainer`
が optional trait である理由 — 存在時は `RangeReader` と clean に合成、
不在時は omit、 forced 退化実装なし。

### `QueryGuard` 付き Search

Container gate (multi は `mergeWhitelistAcrossContainers` 経由) →
guard → optional `dry_run` short-circuit → search → redact。
`QueryGuard.guard()` の戻り値は `Redactor` が直接 consume する
`GuardedRedactSet` を produce する。 set の brand が合成の safety の
全部: caller は `QueryGuard` を経由せずに `GuardedRedactSet` を
construct できないので、 「guard は redact の前に走る」不変条件が
compile time で enforce される。

### Opaque-payload な point read

`ContainerAccess.hasContainer` + `ContainerAccess.isItemAllowed` +
`PointReader.readOne({ fields: [] })` + optional redact。 空の `fields`
list は意図的な signal — payload が opaque、 projection 不適用。 全
opaque-payload op はこの exact shape を再利用する。

### Enumerate

`ContainerAccess.hasContainer` + prefix / pattern overlap pre-check +
`Enumerator.enumerate` + per-item `isItemAllowed` post-filter。 二重
gate (pre-filter overlap check + post-filter per-item) の理由: backend
enumerator (S3 `ListObjects` の prefix、 Redis `SCAN MATCH`) は
advisory で候補集合を絞るが whitelist を enforce しないから。
post-filter が real gate。

### Engine-inspect (`show_processlist` shape)

`Inspector.getProcessList` (method 存在 check 付き) →
`withCappedRows` → per-field sanitiser。 `Inspector` の method は全て
interface 上 optional、 engine ごとに違う sub-capability を露出する
から (MySQL processlist に DDB 相当は無い)。 method-existence check は
trait 不在と同じ `UnsupportedOperationError` path を drive。

---

## Anti-goal (shared surface が意図的に排除するもの)

各項目は「追加しないと決めた物」と「その理由」を名指しする。

1. **Shared に format preset を持たない** (`LogFormat = "pino" | "python" |
   "waf"`)。 却下理由: product 固有 parsing は primitive ではない —
   product が `msg` を field と宣言するなら、 それが input そのもの。
   Preset は org が使う全 log format を知る仕事に shared を巻き込む。

2. **Shared に product 固有 logic を持たない** (`Whitelist.getProductTableName`)。
   却下理由: shared 層を 1 product の naming に couple させる。
   Product wiring が primitives を合成する; wiring は product の
   tool package に居住。

3. **Field 名の hardcode を持たない**。 `@timestamp`, `@message`,
   `payload.userId` は CW-adapter の関心事で、 その adapter の
   `CW_BUILTIN_IDENTIFIERS` 定数に居住。 shared で却下、 「どの
   field 名が built-in か」は backend 別で普遍でない。

4. **Base interface に engine-specific な concession を入れない**。
   DDB の `ProjectionExpression`, Redis glob pattern, MySQL
   `SHOW CREATE TABLE` は全て、 generic primitives の adapter subtype
   として留まる。 base で却下、 1 engine の quirk を shared shape に
   引き入れると、 他 4 が受け入れる必要が生じる。

5. **Primitives に implicit approval / dry-run 前提を持たない**。
   Primitives は `ctx.dryRun` を sniff しない; op factory が明示的に
   branch する。 却下理由: policy flag で behaviour が変わる primitive
   は isolation で test 不能。

6. **1 つの primitive に責務を混ぜない**。 `Whitelist` は redact しない;
   `Redactor` は gate しない; `Projection` は limit しない。 却下理由:
   各 primitive は compose target — 2 頭の primitive は 2 compose 点を
   1 つの opaque surface に潰す。

7. **Trait leak を許さない**。 `RedisWhitelist` に `matchKeyToPattern`
   があるなら、 その method は `RedisWhitelist` のみ、 base
   `Whitelist` の optional method には決してならない。 却下理由:
   「base 型上の optional method」は Pattern A (design decision 参照) と
   区別できない — 全 consumer が存在確認する羽目になる。

8. **Stateful な primitive を持たない**。 `Whitelist`, `Redactor`,
   `Projection`, `LimitPolicy`, `QueryGuard` は pure。 I/O に触れるのは
   `Reader`, `Explainer`, `Inspector`, `Introspector` のみ。 Stateful
   を却下する理由: pure primitive は trivially testable でリクエスト間
   share が安全; stateful なものは shared 層が持つべきでない lifetime
   管理を要する。

9. **Secret default を持たない**。 全 `LimitPolicy` は `defaultLimit`
   と `maxLimit` を expose。 全 `QueryGuard` は excluded / redacted
   set を expose。 隠された default を却下する理由: op の `detail` を
   inspect した caller が、 適用される全 constraint を見えるべき —
   runtime の surprise を避ける。

10. **Primitive で引数 sniffing しない**。 `readOne(x)` は array を
    見て `readMany` に切り替えたりしない。 polymorphic dispatch を
    却下する理由: 1 method 1 behaviour は clean に合成できる; smart
    dispatch はできない。

11. **Unbranded な redact set を持たない**。 `Redactor.redactMany` の
    `redactFieldNames` は `GuardedRedactSet` であって
    `ReadonlySet<string>` ではない。 plain set を却下する理由: plain
    set は任意 call-site で fabricate 可能で guard を bypass する。
    brand が guard→redact chain を compile-time 不変条件にする。

---

## Meta: この file と spec のどちらに置くべきか

file と spec の間の placement の golden test:

- 文を削除して **interface consumer が見る物** の情報が失われるなら、
  spec に居住すべき。
- 文を削除して **なぜこの shape なのか** (decision / trade-off /
  却下した代替案) の情報が失われるなら、 ここに居住すべき。

Test: 1 段落を isolation で読む。 interface を USE する方法を教えて
いるか? → spec。 interface を CHANGE する方法を教えているか? → design。

---

## Pointer

対 spec: `docs/specs/whitelist-abstraction.md`。 Canonical な
interface 定義: `packages/shared/primitives/src/interfaces/*.ts`。
