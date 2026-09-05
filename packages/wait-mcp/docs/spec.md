# wait-mcp 仕様

## 目的

CI の完了・Slack の返信・GitHub Issue の更新など「外部で何かが起きるまで待つ」処理を、**MCP サーバー側のバックグラウンドポーリング**として引き受ける MCP サーバー。

AI エージェントが `sleep` と再確認をループすると、ポーリング 1 回ごとにツール呼び出しと応答がコンテキストに積み上がる。wait-mcp は待機ループをサーバープロセス内に閉じ込め、AI に返るのは**待機開始と結果の 1 往復だけ**にする。ポーリング回数がコンテキスト消費に影響しないことが本サーバーの存在理由である。

## 提供ツール

| ツール | 役割 | 承認 |
| --- | --- | --- |
| `describe` | operation の一覧と個別スキーマの参照（read-only） | 自動承認可 |
| `execute` | operation の実行 | 自動承認可 |

`execute` が扱う操作は、外部サービスに対しては**すべて読み取りのみ**であり、サーバー内部の待機状態を作る／消すだけの可逆操作である。したがって `coding-rules__mcp-tool-approval` の分類上「自動実行 OK」の側に属し、承認必須ツールを別に設けない。この不変条件を守るため、任意コマンド実行やファイル書き込みを行う source は提供しない（「非対象」を参照）。

## 用語

- **watch**: 「どの source を、どの条件で、どれだけの間隔と期限で監視するか」を表す 1 件の待機。`w_1` のような ID を持つ。
- **source**: 監視対象の種別。`github_checks` / `github_issue` / `slack` / `http` / `file`。
- **poll**: source を 1 回評価すること。
- **satisfied**: 条件が満たされ、待機が終わった状態。
- **terminal**: これ以上待っても状況が変わらない状態（成功・失敗の確定を含む）。

## watch の状態

```
waiting ──満たされた──▶ satisfied
   │
   ├──期限切れ────────▶ timeout
   ├──連続エラー上限───▶ failed
   └──cancel──────────▶ cancelled
```

`satisfied` / `timeout` / `failed` / `cancelled` は終了状態であり、以後ポーリングされない。`satisfied` は「期待した結果になった」ではなく「待つ理由が消えた」を意味する。CI が失敗して確定した場合も `satisfied` であり、成否は `details` に載る。

## operations

すべて `execute({ operation, params })` で実行する。

### `sources`

利用可能な source の一覧、または 1 件の設定スキーマを返す。

| params | 型 | 説明 |
| --- | --- | --- |
| `source` | string? | 省略時は全 source の一覧、指定時はその設定スキーマ（JSON Schema） |

### `until`

watch を作り、終了状態になるまでツール呼び出しをブロックする。**通常はこれを使う**。

| params | 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `source` | string | 必須 | source ID |
| `config` | object | 必須 | source 固有の設定 |
| `interval_ms` | number? | source 既定値 | ポーリング間隔。source ごとの下限で切り上げられる |
| `timeout_ms` | number? | 1800000 | watch 全体の期限（上限 86400000） |
| `max_block_ms` | number? | 240000 | 1 回の呼び出しがブロックする上限（上限 3600000） |
| `label` | string? | なし | 一覧表示用の名前 |

`max_block_ms` を超えても終了状態にならない場合、watch は**バックグラウンドで動き続けたまま** `status: "waiting"` を返す。呼び出し側は `join` で待機を再開できる。これは MCP クライアント側のツールタイムアウトより手前で必ず応答を返すための仕組みであり、待機の中断ではない。

### `watch`

watch を作り、即座に ID を返す（ブロックしない）。複数の待機を並行させてから `join` でまとめて待つときに使う。params は `until` から `max_block_ms` を除いたもの。

### `join`

既存の watch が終了状態になるまでブロックする。

| params | 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `ids` | string[] | 必須 | 対象 watch ID |
| `mode` | `"any"` \| `"all"` | `"all"` | `any` は最初の 1 件が終了した時点で返る |
| `max_block_ms` | number? | 240000 | 1 回の呼び出しのブロック上限 |

### `check`

watch を作らず、条件を 1 回だけ評価して結果を返す。設定の検証や、待つ価値があるかの確認に使う。params は `source` と `config`。

### `status`

| params | 型 | 説明 |
| --- | --- | --- |
| `id` | string? | 省略時は全 watch の要約、指定時は 1 件の詳細（直近イベント付き） |
| `include_finished` | boolean? | 既定 `true`。`false` で終了済みを除外 |

### `cancel`

| params | 型 | 説明 |
| --- | --- | --- |
| `id` | string? | 対象 watch |
| `all` | boolean? | `true` で `waiting` の watch をすべて取り消す |

`id` と `all` はどちらか一方を指定する。

## 応答フォーマット

すべての operation は JSON テキストを返す。watch を伴う応答は次の形をとる。

```json
{
  "id": "w_1",
  "source": "github_checks",
  "label": "ci",
  "status": "satisfied",
  "summary": "5/5 checks completed (failure: build)",
  "polls": 14,
  "elapsed_ms": 283000,
  "details": { "outcome": "failure", "checks": [{ "name": "build", "conclusion": "failure" }] },
  "events": ["queued 5 checks", "build failed"]
}
```

`status: "waiting"` の応答には `next` フィールドが付き、待機を再開する呼び出し方を示す。

```json
{
  "id": "w_1",
  "status": "waiting",
  "summary": "3/5 checks completed",
  "polls": 8,
  "elapsed_ms": 240000,
  "next": "execute({ operation: \"join\", params: { ids: [\"w_1\"] } })"
}
```

## source 一覧

### `github_checks` — CI の完了を待つ

`gh` CLI 経由で commit の check-runs を監視する。

| config | 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `repo` | string? | カレントリポジトリ | `owner/name` |
| `ref` | string? | カレントブランチ | ブランチ名または SHA |
| `pr` | number? | なし | 指定すると PR の head SHA を解決して監視する |
| `require` | `"complete"` \| `"success"` | `"complete"` | `success` は失敗確定時点で終了状態にする |
| `cwd` | string? | サーバーの作業ディレクトリ | `gh` / `git` を実行する場所 |

既定間隔 20 秒、下限 5 秒。終了条件は、check-runs が 1 件以上あり全件 `completed`（`require: "success"` の場合は、加えて失敗が 1 件でも確定した時点でも終了）。`details.outcome` は `success` / `failure` / `pending` のいずれか。

### `github_issue` — Issue / PR の更新を待つ

`gh` CLI 経由で Issue（PR を含む）を監視する。

| config | 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `repo` | string? | カレントリポジトリ | `owner/name` |
| `number` | number | 必須 | Issue / PR 番号 |
| `until` | `"new_comment"` \| `"closed"` \| `"state_change"` \| `"label"` | `"new_comment"` | 終了条件 |
| `label` | string? | なし | `until: "label"` のとき必須 |
| `from` | string? | なし | `until: "new_comment"` のとき、コメント投稿者の login で絞り込む |
| `cwd` | string? | サーバーの作業ディレクトリ | `gh` を実行する場所 |

既定間隔 30 秒、下限 10 秒。`new_comment` は watch 作成時点で存在した最新コメントより後のコメントだけを検出する。`state_change` は作成時点の state からの変化、`closed` は state が `closed` になること。

### `slack` — スレッドの返信を待つ

Slack Web API（`conversations.replies` / `conversations.history`）を HTTP で監視する。トークンは環境変数から読む。

| config | 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `channel` | string | 必須 | チャンネル ID |
| `thread_ts` | string? | なし | 指定するとスレッド返信、省略するとチャンネル新着を監視 |
| `match` | string? | なし | 本文に対する正規表現 |
| `from` | string? | なし | 投稿者のユーザー ID |
| `token_env` | string? | `SLACK_BOT_TOKEN` | トークンを読む環境変数名 |

既定間隔 15 秒、下限 5 秒。watch 作成時点で存在したメッセージより後の投稿のうち、`match` / `from` の条件を満たすものが現れたら終了。

### `http` — エンドポイントの状態を待つ

| config | 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `url` | string | 必須 | 監視先 |
| `method` | string? | `GET` | HTTP メソッド |
| `headers` | object? | なし | 追加ヘッダー |
| `body` | string? | なし | リクエストボディ |
| `expect` | object | 必須 | 終了条件（下記） |

`expect` は次を組み合わせる（すべて満たしたときに終了）。

- `status`: 期待するステータスコード、またはその配列
- `body_matches`: 本文に対する正規表現
- `json_path`: `a.b[0].c` 形式のパス
- `json_equals`: `json_path` の値と等しいことを要求する値
- `json_matches`: `json_path` の値（文字列化）に対する正規表現

既定間隔 30 秒、下限 5 秒。

### `file` — ローカルファイルの変化を待つ

| config | 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `path` | string | 必須 | 対象パス |
| `until` | `"exists"` \| `"missing"` \| `"changed"` \| `"matches"` | `"exists"` | 終了条件 |
| `pattern` | string? | なし | `until: "matches"` のとき必須。内容に対する正規表現 |

既定間隔 5 秒、下限 1 秒。`changed` は watch 作成時点の mtime とサイズからの変化を検出する。

## 設定（環境変数）

| 変数 | 既定 | 説明 |
| --- | --- | --- |
| `WAIT_MCP_MAX_BLOCK_MS` | 240000 | `max_block_ms` の既定値 |
| `WAIT_MCP_MAX_WATCHES` | 50 | 同時に `waiting` でいられる watch の上限 |
| `SLACK_BOT_TOKEN` | なし | `slack` source の既定トークン |

`gh` CLI の認証はサーバー側の `gh auth` に従う。

## エラー時のふるまい

- ポーリング中の例外は watch を即座に終わらせず、間隔を指数的に伸ばして（上限 5 分）再試行する。
- 連続 5 回失敗した watch は `failed` になり、最後のエラーメッセージを `summary` に載せる。
- 成功したポーリングは連続エラー数と間隔を既定値に戻す。
- 設定スキーマ違反・未知の source・未知の watch ID は、ポーリングを始める前にエラー応答として返す。

## 非対象

- **任意コマンド実行 / スクリプト実行の source を持たない。** これを入れると `execute` が「AI に自動実行させてよいツール」でなくなり、`coding-rules__mcp-tool-approval` の分類が崩れるため。
- **待機状態をディスクに永続化しない。** watch はサーバープロセスの寿命に閉じる。プロセスが終われば待つ主体も消える。
- **通知の送信・外部への書き込みを行わない。** 結果は待っている呼び出し側にだけ返る。
