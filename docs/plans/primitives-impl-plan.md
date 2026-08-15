# 実装計画: mcp-shared-primitives（whitelist 抽象化の最抽象レイヤ）

> **絶対ルール**: spec.md → design.md → impl の順。`.md` に無い挙動は実装しない。抽象化は interface＋ポリモーフィズム。
> 権威文書: `docs/specs/whitelist-abstraction.md`（RFC-2119 契約・正本）/ `docs/designs/whitelist-abstraction.md`（なぜ）。
> 出所: 参照実装（canonical）。本リポは無スコープ命名 `mcp-shared-primitives` を採用。

## レイヤ分類（明示）
| レイヤ | 置き場 | 中身 | 依存 |
|---|---|---|---|
| **更に抽象（backend/tool 非依存・最抽象）** | **`packages/shared/primitives`（新規）** | Core interfaces（Whitelist / FieldWhitelist / ContainerAccess）、optional traits（Projection / Redactor / GuardedRedactSet / LimitPolicy / ContainerResolver / QueryGuard / Explainer / PointReader…Enumerator / JsonPathReader / Inspector / Introspector）、ToolContext / Operation、helpers（defaultClamp / withCappedRows / mergeWhitelistAcrossContainers / createStandardRespond）、errors（UnsupportedOperationError）、op factories（createFindByPkOp…createEnumerateOp） | zod のみ（純型＋純関数） |
| **shared db 固有** | 既存 `packages/mcp-shared-db-*` | 上記 trait を **実装する RDB adapter**（matrix: FieldWhitelist / Projection=string[] / EqReader / RangeReader(Date) / Inspector / Explainer / QueryGuard=assertSelectOnly） | → primitives |
| **mcp tool 固有** | 各 mcp server | whitelist を **compile-in** し、factory から作った op を register | → primitives ＋ 該当 adapter |

## 実装順序（依存順・各ステップ spec 準拠のテスト付き）
- [x] 0. worktree `feat/commonization-primitives`、spec.md / design.md を docs/ に設置
- [x] 1. パッケージ scaffold（`packages/shared/primitives/{package.json,tsconfig.json,src/index.ts}`、deps=zod のみ・build は tsc・workspace 自動認識）
- [x] 2. **errors**（`UnsupportedOperationError{tool,trait}`、spec 準拠で著述）
- [x] 3. **Core interfaces**（`interfaces/whitelist.ts`: FieldVisibility / FieldPolicy / FieldWhitelistContainer / Whitelist / FieldWhitelist / ContainerLimits / ContainerAccess、参照実装(canonical)を faithful 移植）
- [x] 4. **reader traits**（`interfaces/readers.ts`）＋ redactor / query-guard（GuardedRedactSet brand）/ projection / limit-policy / container-resolver / explainer / inspector / introspector / json-path-reader（全て faithful 移植・index export・tsc/oxlint green）
- [x] 5. **context / operation**（ToolContext / ctx.trait / Operation / OperationTraits、faithful 移植・スコープ表記を中立化・export・tsc/oxlint green）
- [x] 6. **helpers**（テスト先行、defaultClamp/merge/respond。withCappedRows は非該当）:
  - [x] `defaultClamp`（LimitPolicy factory。clamp の全規則を 24 tests で固定・green）
  - [x] `mergeWhitelistAcrossContainers`（strictest-wins、6 tests・faithful移植）
  - [x] `createStandardRespond`（StandardRespond/Labels、9 tests・faithful移植）
  - [x] ~~`withCappedRows`~~（canonical に standalone helper 無し。inspect factory も row cap を持たず＝row cap/masking は tool の `invoke` 側の責務。新設しない）
- [x] 7. **op factories（10/10 完成）**（respond callback は input.args を受ける／preContainerGate hook は container-read/enumerate のみ）
  - [x] createFindByPkOp（6 tests）/ createFindByEqOp（5）/ createFindByRangeOp（EXPLAIN gate, 6）
  - [x] createSearchOp（QueryGuard+dryRun, 7）/ createMultiSearchOp（merge strictest-wins, 7）
  - [x] createContainerReadOp（ContainerAccess+isItemAllowed, 8）/ createEnumerateOp（6）
  - [x] createInspectionOp（capability+container gate, 7）/ createExplainOp（whitelist bypass, 5）/ createJsonSearchOp（5）
  - 全 op ops/index.ts export・tsc/oxlint/vitest green（計101 tests）
- [x] 8. **primitives integration テスト（完了）**（`src/__tests__/integration.test.ts`：spec §Behaviour rules 準拠の単一 in-memory backend を ToolContext に束ね、find-by-pk/eq・container-read・enumerate を同一 ctx で E2E 検証＝gate→project→redact→respond、secure-by-default(未宣言/exclude=非出力, select 無=redact), limit clamp=defaultClamp, GuardedRedactSet override＋ index.ts 全 export 検証。**primitives 完璧化**: 10 ops + 3 helpers + integration、計109 tests green、tsc/oxlint 0。

## 順序（ユーザー確定）
1. **primitives を完璧に**（Step1-8：全 interface＋helpers＋op factories＋integration テスト。純粋ゆえ docker 不要）← 最優先
2. **adapter（shared db 固有）**：`mcp-shared-db-*` 等に primitives の trait を実装＋**実 DB integration テスト（docker compose: mysql/postgres/firestore emulator）**。DB は mysql/postgres/firestore を全対応。
3. **個別 mcp 実装＝最後**：各 mcp server は **`describe`/`execute` の2種の tool のみ**（op は OperationRegistry 登録、`createDescribeExecuteHandlers` パターン厳守）。whitelist を compile-in。

- [ ] （2）adapter＋実 DB integration＋compose
- [ ] （3・最後）個別 mcp（describe/execute のみ）

## 実装方針メモ
- interface は参照実装(canonical)の .ts を faithful に移植（純型＝コピペ相当、import/scope のみ調整）。挙動を持つ helper/factory は **spec の RFC-2119 規則からテストを起こしてから実装**。
- 「.md に無い挙動は実装しない」= spec の behaviour rules / capability matrix / I/O 例に無いものは足さない。
- secure-by-default（getFieldPolicy 既定 redact、未 whitelist は exclude）等の不変条件は spec の該当規則をテストで固定。

## ループ停止時点の状態（要判断ポイント）
- **完了**: Step1-5（全 interface）＋ Step6 の `defaultClamp`。branch `feat/commonization-primitives`、commit 871a711/1b969d9/a6409a0/5c7f7a0。**worktree・git履歴とも実mico ゼロ**、tsc=0、vitest 24 green、oxlint 0。未 push。
- **残**: Step6 残り（mergeWhitelistAcrossContainers / createStandardRespond / withCappedRows）、Step7（op factories）、Step8（全export+green）、（別 PR）adapter 実装。
- **停止理由＝2つの要判断**:
  1. **置き場/スコープ（§6）**: 本リポ無スコープ `mcp-shared-primitives` で継続してよいか。別スコープへ寄せるなら早期に確定したい（純 interface 主体なので再配置は容易）。
  2. **ルール適用（Step7 に効く）**: op factories / merge / respond の**挙動は spec.md より canonical 実装側に多く存在**。「.md に無い情報は実装しない」を厳守すると、canonical の faithful 移植（挙動含む）を「.md 準拠」とみなしてよいか、それとも spec の step-list / I/O 例だけからテスト先行で著述するか、の判断が要る。前者は速いが .md 外挙動が混入しうる／後者は厳密だが spec の粒度に依存。

## 未解決（§6 と連動・impl の置き場に影響しうる）
- 本リポ（無スコープ `mcp-shared-*`）に置くのが正か、スコープ付き命名へ寄せるのか。→ 純 interface なので後で再配置容易。現状は本リポ命名で進める。
