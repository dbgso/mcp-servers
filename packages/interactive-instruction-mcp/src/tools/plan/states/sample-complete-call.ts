export const SAMPLE_COMPLETE_CALL = `
plan(action: "status", id: "<task-id>", status: "completed",
  changes: [
    {
      file: "src/tools/plan/handlers/status-handler.ts",
      lines: "75-112",
      description: "STOP メッセージ追加。pending_review 時に What/Why/References テンプレートを出力し、ユーザーが承認するまで次のタスクに進めないようにした"
    },
    {
      file: "src/tools/plan/handlers/list-handler.ts",
      lines: "52-71",
      description: "pending_review セクション追加。タスクの deliverables, completion_criteria, output を表形式で表示"
    }
  ],
  why: "完了条件「pending_review時に強制停止、listで詳細表示」を満たす。status-handler.ts で STOP メッセージを出力し、list-handler.ts で pending_review タスクの詳細を表示するようにした。",
  references_used: ["coding-rules/typescript"],
  references_reason: "TypeScript の型定義ルールに従い、TaskStatus 型を使用した"
)

// 参照なしの場合:
plan(action: "status", id: "<task-id>", status: "completed",
  changes: [
    {
      file: "src/services/plan-reporter.ts",
      lines: "1-175",
      description: "新規作成。PENDING_REVIEW.md と GRAPH.md を自動生成するサービス。タスク状態変更時に updateAll() で両ファイルを更新"
    }
  ],
  why: "完了条件「状態変更時に .md ファイルを自動更新」を満たす。add/status/approve/delete/clear の各ハンドラーで planReporter.updateAll() を呼び出し、常に最新状態を反映。",
  references_used: null,
  references_reason: "既存の plan-reader.ts のパターンに従って実装。外部ドキュメント参照不要"
)`;
