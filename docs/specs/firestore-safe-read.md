# Firestore safe-read spec (backend delta)

Firestore (GCP Cloud Firestore) を共通 primitives 契約の一 backend として実装するときの、**Firestore 固有の差分だけ** を規定する。

**共通契約は `docs/specs/whitelist-abstraction.md` が正本**で、本書はそれを再掲しない。secure-by-default、whitelist の compile-in / 人間 review、未定義 field = exclude、`fields: {}` = 全 exclude、read-only、codegen skeleton が `expose` を emit 不能、defense-in-depth（project → read → redact）— これらは **primitives 層が構造的に強制する共通不変条件**であり Firestore 固有ではないため、ここには書かない。

ここに書くのは「primitives だけでは決まらない、Firestore backend 固有の写像・機構・選択」のみ。

---

## 1. 用語の写像（Firestore 固有）

| 共通概念 | Firestore での実体 |
|---|---|
| Container | top-level collection 名（例 `users`）。collection-group（同名 subcollection 横断）は別 op（§4）| 
| Field | document field 名。ネスト map は **dotted path**（`profile.email`）で1 field として addressable。array 内 map も dotted path で到達 |
| 概念上の注意 | Firestore は schemaless（document ごとに field 集合が異なる）→ field の存在・型は sampling でしか分からない（§5） |

## 2. config データモデル（Firestore 固有の型）

```ts
export type FsFieldType =
  | "string" | "number" | "boolean" | "timestamp"
  | "geopoint" | "reference" | "bytes" | "null" | "array" | "map";

export interface FsFieldEntry {
  select: "expose" | "exclude";      // 共通の visibility 契約に従う。既定の埋め方は primitives 側
  type: FsFieldType;                  // sampling 推論（Firestore の型集合）
  observedTypes?: readonly FsFieldType[];
  description?: string;
  excludeReason?: string;
}

export interface FsCollectionConfig<TFieldPaths extends string = string> {
  description?: string;
  fields: { [K in TFieldPaths]: FsFieldEntry };   // key は dotted field path
  defaultLimit?: number;
  maxLimit?: number;
}

export interface FsSelectableFieldsConfig {
  collections: { [collectionName: string]: FsCollectionConfig };
}
```

固有点は **`FsFieldType`（Firestore の型集合）** と **key が dotted field path**（ネスト map / array 内 map を単一 field として扱える）ことのみ。visibility の意味（expose/exclude）や secure-by-default の埋め方は共通契約側。

## 3. visibility は 2-state（Firestore 固有の選択）

共通 Core `FieldVisibility` は 3-state（expose/redact/exclude）だが、**Firestore adapter は expose/exclude の 2-state のみ**を使う（`getFieldPolicy` は redact を返さない）。

理由（Firestore 固有）: Firestore の field アクセスは `select()` FieldMask = 返す/返さないの2択。`where(f,"==",v)` は caller が既に値を保持しており redact で守れる情報が実質ない（filter-but-mask を表す DSL が無い）。→ redact 中間状態が Firestore では意味を持たない。

## 4. 強制機構と op の写像（Firestore 固有）

- **projection = `select()` FieldMask**: expose field（dotted path）のみを FieldMask に列挙して get/query する。これが Firestore における `Projection` trait の具体。
- **post-fetch filter は dotted path / array 要素へ再帰適用**（親 expose ＋ 子 exclude、`items[].sku` 等）。
- **op → Firestore API**:
  - `PointReader` = `doc(path).get()`（key = document path、無ければ null）
  - `EqReader` = `where(f,"==",v)` / `RangeReader` = `where(f, ">="/"<=", v)`・orderBy（orderable field のみ）
  - `SearchReader` = 複合 where + orderBy + limit（composite index 前提）
  - `Enumerator` = collection の document 列挙（cursor = `startAfter`）
  - **collection-group query** = 別 trait（`MultiContainerSearchReader` 相当。全 subcollection 横断）
- **approval gate（Firestore 固有の op リスク割当）**: collection-group query と無制限 collection 列挙のみ gate（cost / blast-radius 大）。point get / bounded query は gate 不要。※「危険 op を gate する」枠組み自体は共通、どの Firestore op が危険かの割当が固有。

## 5. codegen の source（Firestore 固有）

codegen の shell / secure-by-default / never-overwrite は共通。**Firestore 固有なのは introspection source のみ**:

- collection discovery: `listCollections()`（root）
- field 推論: 各 collection から document を sample（既定 50 件）し、dotted field path の union と型を推論。複数型観測は `observedTypes[]` に記録
- retry axis: sample 件数を増やす（Firestore の sampling strategy）

## 6. runtime config sourcing（GCP 固有）

共通の「tool package が plain 値に解決して adapter へ渡す / whitelist と endpoint は compile-in」は不変。**GCP 固有の解決手段のみ**:

- credentials: Application Default Credentials / service account JSON（`secret://` 経由で fetch 可）/ `GOOGLE_APPLICATION_CREDENTIALS`
- adapter constructor 引数: `{ projectId, databaseId?, credentials? }`
- **テストは `FIRESTORE_EMULATOR_HOST`（emulator）** で実 GCP に触れない

## 7. primitives capability matrix（Firestore の行）

| trait | Firestore |
|---|---|
| Core `FieldWhitelist` | yes（redact 不使用、§3）|
| `Projection` | yes（`select()` FieldMask）|
| `Redactor` | yes（post-fetch defense-in-depth）|
| `LimitPolicy` | yes |
| `PointReader` | yes |
| `EqReader` / `RangeReader` | yes（range は orderable field）|
| `SearchReader` | yes（composite index 前提）|
| collection-group search | yes（`MultiContainerSearchReader` 相当・要 approval）|
| `Enumerator` | yes（無制限列挙は要 approval）|
| `Introspector` | yes（sampling、§5）|
| `Explainer` | no / partial（Firestore の explain は限定的。degenerate 実装 or 未登録を design で確定）|
| `Inspector` | —（engine-state 概念なし）|

## 8. integration テスト方針（Firestore 固有）

unit（FieldMask 構築 / post-fetch の dotted・array 再帰 / QueryGuard の field 参照拒否）は emulator 不要。実 query 意味論（composite index / orderBy 制約 / collection-group）は **emulator 必須**で `skipIf(!FIRESTORE_EMULATOR_HOST)`。seed→実 query で検証。

---

Paired design（Firestore 固有の判断のみ。共通の rationale は whitelist-abstraction design 側）: `docs/designs/firestore-safe-read.md`。
