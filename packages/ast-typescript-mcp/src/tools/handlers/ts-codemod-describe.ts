import { z } from "zod";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";

function textResponse(text: string): ToolResponse {
  return {
    content: [{ type: "text" as const, text }],
  };
}

const TsCodemodDescribeSchema = z.object({
  task: z
    .string()
    .optional()
    .describe(
      "Description of the transformation task to analyze applicability"
    ),
});

type TsCodemodDescribeArgs = z.infer<typeof TsCodemodDescribeSchema>;

interface ApplicabilityResult {
  applicable: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  alternatives?: string[];
  example?: {
    source: string;
    target: string;
  };
}

/**
 * Keywords/patterns that indicate ts_codemod is applicable
 */
const APPLICABLE_PATTERNS = [
  { pattern: /パターン|pattern/i, weight: 2 },
  { pattern: /置換|replace|変換|transform|convert/i, weight: 2 },
  { pattern: /一括|batch|bulk|all|全て/i, weight: 1 },
  { pattern: /関数呼び出し|function call|メソッド呼び出し|method call/i, weight: 2 },
  { pattern: /引数|argument|parameter/i, weight: 1 },
  { pattern: /削除|remove|delete/i, weight: 1 },
  { pattern: /console\.log|デバッグ|debug/i, weight: 1 },
  { pattern: /ラップ|wrap/i, weight: 2 },
  { pattern: /フォーマット|format/i, weight: 1 },
];

/**
 * Keywords/patterns that indicate ts_codemod is NOT applicable
 */
const NOT_APPLICABLE_PATTERNS = [
  { pattern: /型|type|interface/i, reason: "型に基づく変換は未対応（型情報を解析しない）", alternative: "ts-morphで型チェック後に手動適用" },
  { pattern: /スコープ|scope|変数の参照|variable reference/i, reason: "スコープ認識が必要な変換は未対応", alternative: "手動変換またはts-morph直接使用" },
  { pattern: /リネーム|rename|名前変更/i, reason: "参照の自動追跡が必要な場合は未対応", alternative: "rename_symbol ツールを使用" },
  { pattern: /インポート|import|エクスポート|export/i, reason: "モジュール解決が必要な変換は未対応", alternative: "ts-morphで依存関係を解析" },
  { pattern: /条件付き|conditional|〜の場合|if.*then/i, reason: "条件付き変換（コンテキストによって異なる変換）は未対応", alternative: "手動変換" },
  { pattern: /意味|semantic|セマンティック/i, reason: "意味解析が必要な変換は未対応", alternative: "ts-morphで意味解析" },
  { pattern: /継承|inheritance|extends|implements/i, reason: "型階層の解析が必要な変換は未対応", alternative: "type_hierarchy + 手動変換" },
  { pattern: /使用箇所|usage|どこで使われ/i, reason: "参照追跡が必要な変換は未対応", alternative: "find_references ツールを使用" },
];

/**
 * Analyze if ts_codemod is applicable for a given task
 */
function analyzeApplicability(task: string): ApplicabilityResult {
  // Check for NOT applicable patterns first (higher priority)
  for (const { pattern, reason, alternative } of NOT_APPLICABLE_PATTERNS) {
    if (pattern.test(task)) {
      return {
        applicable: false,
        confidence: "high",
        reason,
        alternatives: [alternative],
      };
    }
  }

  // Check for applicable patterns
  let score = 0;
  for (const { pattern, weight } of APPLICABLE_PATTERNS) {
    if (pattern.test(task)) {
      score += weight;
    }
  }

  if (score >= 3) {
    return {
      applicable: true,
      confidence: "high",
      reason: "テキストパターンベースの変換として実行可能",
      example: suggestExample(task),
    };
  } else if (score >= 1) {
    return {
      applicable: true,
      confidence: "medium",
      reason: "パターンが明確に定義できれば実行可能。dry_run: trueで事前確認を推奨",
      example: suggestExample(task),
    };
  }

  return {
    applicable: false,
    confidence: "low",
    reason: "タスクの詳細が不明確。より具体的な変換内容を記述してください",
    alternatives: ["タスクを「X を Y に変換したい」の形式で記述"],
  };
}

/**
 * Suggest an example based on the task description
 */
function suggestExample(task: string): { source: string; target: string } | undefined {
  if (/console\.log|デバッグ|debug/i.test(task)) {
    return {
      source: "console.log(:[_])",
      target: "",
    };
  }
  if (/ラップ|wrap/i.test(task)) {
    return {
      source: ":[expr]",
      target: "wrapper(:[expr])",
    };
  }
  if (/引数.*オブジェクト|object.*argument|params/i.test(task)) {
    return {
      source: "func(:[a], :[b])",
      target: "func({ a: :[a], b: :[b] })",
    };
  }
  return undefined;
}

/**
 * Generate overview of ts_codemod capabilities
 */
function generateOverview(): string {
  return `# ts_codemod ツール

comby スタイルのパターンマッチングによるコード変換ツール。

## プレースホルダー構文

| 構文 | 説明 |
|------|------|
| \`:[name]\` | 名前付きキャプチャ（括弧のバランスを考慮） |
| \`:[_]\` | 匿名プレースホルダー（キャプチャしない） |

## 使用例

### 関数呼び出しの変換
\`\`\`
source: "query(:[file], :[type])"
target: "query({ filePath: :[file], queryType: :[type] })"
\`\`\`
結果: \`query(a, b)\` → \`query({ filePath: a, queryType: b })\`

### デバッグログの削除
\`\`\`
source: "console.log(:[_])"
target: ""
\`\`\`

### ネストした括弧
\`foo(bar(baz), qux)\` にマッチ → \`:[a]\` = \`bar(baz)\`, \`:[b]\` = \`qux\`

---

## 適用可能なケース ✅

| ケース | 説明 |
|--------|------|
| テキストパターン変換 | 関数シグネチャの一括変更 |
| 引数順序の入れ替え | \`f(a, b)\` → \`f(b, a)\` |
| ラッパー追加 | \`x\` → \`wrap(x)\` |
| コード削除 | デバッグログの削除 |
| 括弧バランス考慮 | ネストした括弧も正しくマッチ |

## 適用できないケース ❌

| ケース | 理由 | 代替手段 |
|--------|------|----------|
| 型に基づく変換 | 型情報を解析しない | ts-morphで型チェック後に手動適用 |
| スコープ認識 | 変数スコープを追跡しない | 手動変換 |
| リネーム+参照更新 | 参照追跡が必要 | \`rename_symbol\` ツール |
| 条件付き変換 | コンテキスト判断が必要 | 手動変換 |
| インポート解決 | モジュール解決が必要 | ts-morphで依存関係解析 |

---

## 適用可否の判定

タスク記述を渡すと適用可否を判定します：

\`\`\`
ts_codemod_describe({ task: "console.logを全て削除したい" })
\`\`\`

**出力例:**
\`\`\`json
{
  "applicable": true,
  "confidence": "high",
  "reason": "テキストパターンベースの変換として実行可能",
  "example": {
    "source": "console.log(:[_])",
    "target": ""
  }
}
\`\`\`

---

## 使用方法

\`\`\`
ts_codemod({
  source: "変換元パターン",
  target: "変換先パターン",
  path: "ファイル/ディレクトリパス",
  dry_run: true  // デフォルト: プレビューのみ
})
\`\`\`
`;
}

export class TsCodemodDescribeHandler extends BaseToolHandler<TsCodemodDescribeArgs> {
  readonly name = "ts_codemod_describe";
  readonly description =
    "Get ts_codemod usage guidelines or analyze if a task is applicable. Without task: overview. With task: applicability analysis.";
  readonly schema = TsCodemodDescribeSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      task: {
        type: "string",
        description:
          "Description of the transformation task to analyze applicability",
      },
    },
  };

  protected async doExecute(args: TsCodemodDescribeArgs): Promise<ToolResponse> {
    const { task } = args;

    if (!task) {
      return textResponse(generateOverview());
    }

    const result = analyzeApplicability(task);
    const lines: string[] = [];

    lines.push(`# ts_codemod 適用可否判定`);
    lines.push("");
    lines.push(`**タスク:** ${task}`);
    lines.push("");
    lines.push(`## 判定結果`);
    lines.push("");
    lines.push(`| 項目 | 値 |`);
    lines.push(`|------|-----|`);
    lines.push(`| 適用可否 | ${result.applicable ? "✅ 適用可能" : "❌ 適用不可"} |`);
    lines.push(`| 確信度 | ${result.confidence} |`);
    lines.push(`| 理由 | ${result.reason} |`);
    lines.push("");

    if (result.alternatives && result.alternatives.length > 0) {
      lines.push(`## 代替手段`);
      lines.push("");
      for (const alt of result.alternatives) {
        lines.push(`- ${alt}`);
      }
      lines.push("");
    }

    if (result.example) {
      lines.push(`## 推奨パターン例`);
      lines.push("");
      lines.push("```");
      lines.push(`source: "${result.example.source}"`);
      lines.push(`target: "${result.example.target}"`);
      lines.push("```");
      lines.push("");
    }

    if (result.applicable) {
      lines.push(`## 次のステップ`);
      lines.push("");
      lines.push("1. `dry_run: true` でプレビュー確認");
      lines.push("2. 結果を確認し、必要に応じてパターンを調整");
      lines.push("3. `dry_run: false` で実際に適用");
    }

    return textResponse(lines.join("\n"));
  }
}
