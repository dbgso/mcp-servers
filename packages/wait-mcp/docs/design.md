# wait-mcp 設計

仕様は `spec.md`。本書は実装の構造と設計判断を述べる。

## レイヤ構成

```
MCP client
   │  describe / execute
   ▼
tools/            … mcp-shared の createDescribeExecuteHandlers で生成した describe/execute ペア
   ▼
operations/       … until / watch / join / check / status / cancel / sources
   ▼
watch/manager.ts  … watch の生成・ポーリングループ・待機者への通知
   ▼
sources/          … source ごとの poll 実装（github_checks / github_issue / slack / http / file）
   ▼
deps              … runCommand / httpRequest / fs / env / clock（注入）
```

上から下へのみ依存する。`sources` は `watch` を知らず、`watch` は `operations` を知らない。

## ディレクトリ

```
src/
  index.ts                 起動エントリ
  server.ts                MCP サーバー（stdio）
  config.ts                環境変数からの既定値解決
  tools/
    index.ts
    registry.ts            ToolRegistry 組み立て
  operations/
    index.ts
    registry.ts            OperationRegistry 組み立て
    types.ts               WaitContext
    wait-ops.ts            until / watch / join / check
    manage-ops.ts          status / cancel / sources
    format.ts              watch → 応答 JSON の整形（純関数）
  watch/
    manager.ts             WatchManager
    types.ts               Watch / WatchStatus / WatchSpec
    schedule.ts            間隔・バックオフ・期限の計算（純関数）
    clock.ts               Clock 抽象（now / sleep）
  sources/
    index.ts
    types.ts               WatchSource / PollOutcome / SourceDeps
    registry.ts            source ID → 実装
    github-checks.ts
    github-issue.ts
    slack.ts
    http.ts
    file.ts
    evaluate/              各 source の判定純関数
      check-runs.ts
      issue.ts
      slack.ts
      http-expect.ts
      json-path.ts
  deps/
    default.ts             実 I/O 実装（execFile / fetch / node:fs）
```

## 中心となる型

```ts
type WatchStatus = "waiting" | "satisfied" | "timeout" | "failed" | "cancelled";

interface PollOutcome {
  satisfied: boolean;
  summary: string;
  state?: SourceState;      // 次回 poll に引き継ぐ差分基準（baseline）
  details?: unknown;
  events?: string[];
}

interface WatchSource<TConfig> {
  id: string;
  summary: string;
  detail: string;
  category: string;
  defaultIntervalMs: number;
  minIntervalMs: number;
  configSchema: z.ZodType<TConfig>;
  poll(params: { config: TConfig; state: SourceState; deps: SourceDeps }): Promise<PollOutcome>;
}

interface SourceDeps {
  runCommand(cmd: string, args: string[], opts?: { cwd?: string }): Promise<CommandResult>;
  httpRequest(req: HttpRequest): Promise<HttpResponse>;
  readFileText(path: string): Promise<string>;
  statFile(path: string): Promise<FileStat | null>;
  env(name: string): string | undefined;
  now(): number;
}
```

source は自分の状態を持たない。差分検出に必要な基準（最新コメント ID、最後に見た Slack の ts、ファイルの mtime など）は `PollOutcome.state` として返し、`WatchManager` が watch に保持して次回の `poll` に渡す。これにより source は純粋な「入力 → 判定」に近づき、`state` を組み立てるだけで任意の時点から単体テストできる。

## WatchManager

`WatchManager` は watch の一覧と、それぞれのポーリングループを持つ。

- `create(spec)`: 設定を source のスキーマで検証し、`w_<連番>` の ID を採番して watch を登録し、ポーリングループを起動して即座に watch を返す。`waiting` の件数が上限に達しているときはエラー。
- `join(ids, mode, maxBlockMs)`: 対象 watch の解決 Promise を集め、`all` なら全件、`any` なら最初の 1 件を待つ。同時に `maxBlockMs` のタイマーを競合させ、先に切れたら `waiting` のまま返す。watch 自体は止めない。
- `checkOnce(source, config)`: watch を作らずに `poll` を 1 回呼ぶ。
- `cancel(id)` / `cancelAll()`: `waiting` の watch を `cancelled` にして解決する。
- `list()` / `get(id)`: 状態参照。

ポーリングループは watch ごとの独立した非同期ループで、1 回のイテレーションで「poll → 判定 → 次回間隔を決めて sleep」を行う。終了状態になった時点でループを抜け、watch の解決 Promise を resolve する。待機者がいなくても watch は最後まで走り、結果は `status` から読める。

### 時間の扱い

現在時刻と待機は `Clock`（`now()` / `sleep(ms)`）にのみ依存させ、既定実装は `Date.now` と `setTimeout`。テストは手動で時刻を進められる `ManualClock` を注入する。`sleep` を偽物にできることで、30 分の待機を含むシナリオもミリ秒で検証できる。実時間に依存したテストもフェイクタイマーの巻き戻しも要らない。

### 間隔とバックオフ

`watch/schedule.ts` に純関数として置く。

- `resolveInterval(requested, source)`: 要求値を source の下限で切り上げ、未指定なら source の既定値。
- `nextIntervalMs(baseMs, consecutiveErrors)`: 連続エラー数に対して `base * 2^errors` を返し、5 分で頭打ち。エラー 0 なら `base`。
- `remainingMs(startedAt, timeoutMs, now)`: 残り時間。0 以下なら期限切れ。
- 次の sleep は `min(nextIntervalMs, remainingMs)` とし、期限をまたいで眠らない。

連続エラーが上限（5）に達したら `failed`。成功した poll は連続エラー数を 0 に戻す。

## source 実装

### `github_checks`

`gh` を子プロセスで呼ぶ。

1. `pr` 指定時は初回のみ `gh api repos/{owner}/{repo}/pulls/<n> --jq .head.sha` で head SHA を解決し `state` に保存する。
2. `ref` 未指定かつ `pr` 未指定なら初回のみ `git rev-parse --abbrev-ref HEAD` でブランチを解決する。
3. 毎回 `gh api repos/{owner}/{repo}/commits/<ref>/check-runs` を呼び、`check_runs[]` を取得する。

`repo` 未指定時は `{owner}` `{repo}` のプレースホルダをそのまま渡し、`gh` にカレントリポジトリを解決させる。判定は `evaluate/check-runs.ts` の純関数 `evaluateCheckRuns(runs, { require })` が行い、`{ satisfied, outcome, completed, total, failed[] }` を返す。`in_progress` / `queued` が残っていれば未達、全件 `completed` なら達成、`require: "success"` かつ失敗が確定していればその時点で達成（それ以上待っても結果は変わらないため）。

### `github_issue`

毎回 `gh api repos/{owner}/{repo}/issues/<n>` と `.../comments?per_page=100` を呼び、`evaluate/issue.ts` の `evaluateIssue({ issue, comments, baseline, config })` で判定する。初回 poll では baseline（その時点の state / 最新コメント ID / ラベル集合）を確定させ、`satisfied: false` を返す。以後は baseline との差分だけを見る。`from` 指定時は投稿者 login が一致するコメントのみを新着として数える。

### `slack`

`thread_ts` の有無で `conversations.replies` と `conversations.history` を切り替え、`httpRequest` で呼ぶ。トークンが未設定ならその旨のエラーを投げる（連続エラーとして扱われ、最終的に `failed` になる）。判定は `evaluate/slack.ts` の `selectNewMessages({ messages, baselineTs, match, from })`。Slack の `ts` は文字列だが辞書順ではなく数値として比較する。

### `http`

`httpRequest` の結果を `evaluate/http-expect.ts` の `evaluateExpectation(response, expect)` に渡す。JSON パスの解決は `evaluate/json-path.ts` の `resolveJsonPath(value, path)`（`a.b[0].c` 形式、見つからなければ `undefined`）。JSON パースに失敗した応答は「JSON 条件は不成立」として扱い、例外にはしない（デプロイ途中の 502 応答などで watch を殺さないため）。

### `file`

`statFile` / `readFileText` のみを使う。`exists` / `missing` は stat の有無、`changed` は初回 stat（mtime とサイズ）との差、`matches` は内容に対する正規表現。ファイルが存在しない場合の `matches` は未達であってエラーではない。

## MCP ツール層

`mcp-shared` の `createOperationRegistry` と `createDescribeExecuteHandlers({ prefix: "", ... })` をそのまま使い、`describe` / `execute` を生成する。ツール名に `wait_` のような接頭辞は付けない。名前空間は MCP サーバー単位で既に分かれており（`mcp__wait-mcp__describe`）、接頭辞は同じ情報の二重化にしかならないため。operation の一覧・スキーマ提示・パラメータ検証・エラー整形は共有実装に任せ、本パッケージ固有のコードは operation 本体に限る。

`buildContext` は毎回同じ `WatchContext`（プロセス単位の `WatchManager` シングルトン）を返す。watch はプロセス内の状態なので、呼び出しごとに作り直してはならない。

## 設計判断

### なぜブロッキング呼び出しなのか

「watch を作って後で取りに行く」だけの API にすると、AI 側が結果を取りに行くタイミングを自分で決めることになり、結局ポーリングがコンテキストに戻ってくる。ツール呼び出し自体をブロックすれば、待機の間に消費されるトークンはゼロで、往復は 1 回で済む。

### なぜ `max_block_ms` で必ず返すのか

MCP クライアントにはツール呼び出しのタイムアウトがあり、それを超えるとクライアント側で呼び出しが失敗する。サーバーがクライアントより先に「まだ待っている」を返せば、失敗ではなく継続として扱える。`join` で待機を再開する形にすることで、長い待機は「小さな応答が数回」に分割され、コンテキスト消費は一定に保たれる。

### なぜ任意コマンド実行の source を持たないのか

`coding-rules__mcp-tool-approval` はツール単位で承認が決まることを前提に、自動実行してよい操作と承認が要る操作を別ツールに分けることを求める。任意コマンドを実行できる source を 1 つ入れるだけで `execute` 全体が承認必須側に落ち、「AI が勝手に待てる」という本サーバーの価値が消える。待機対象は read-only な観測に限り、副作用のある処理は呼び出し側のツールに残す。

### なぜ永続化しないのか

watch の価値は「いま待っている呼び出し側がいる」ことにある。プロセスが落ちれば待っていた呼び出しも失われるので、状態だけを残しても再開する主体がいない。ディスク上の状態はゴミになるだけなので持たない。

## テスト方針

`coding-rules__test-coverage`（95%）を満たすため、次の 4 層で検証する。

1. **判定純関数**（`sources/evaluate/*`, `watch/schedule.ts`）: 入力バリエーションを `it.each` / `describe.each` でまとめて検証する。
2. **source の poll**: `SourceDeps` にフェイク（`gh` の応答 JSON、HTTP 応答、fs）を注入し、初回 baseline 確定 → 変化検出 → エラー伝播の 3 系統を検証する。
3. **WatchManager**: `ManualClock` を注入し、満了・タイムアウト・連続エラーでの `failed`・`cancel`・`join(any/all)`・`max_block_ms` 到達時の `waiting` 応答を検証する。
4. **operation 層**: `execute` 相当の経路で、未知 operation・設定スキーマ違反・未知 watch ID を含めて応答 JSON の形を検証する。

外部プロセス（`gh`）と外部 API（Slack）は一切起動しない。テストのフィクスチャは `coding-rules__test-fixtures` に従いテスト内で組み立てる。
