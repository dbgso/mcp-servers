---
whenToUse:
  - Writing new code
  - Refactoring existing code
  - Reviewing code quality
  - Learning project coding standards
---

# コーディング規約

保守性・可読性の高いコードを書くための基本的なルール集。

## 基本原則

### DRY (Don't Repeat Yourself)
- 同じコードを繰り返さない
- 共通処理は関数・モジュールに抽出する

### KISS (Keep It Simple, Stupid)
- シンプルな実装を心がける
- 複雑なロジックは分割して理解しやすくする

### YAGNI (You Aren't Gonna Need It)
- 必要になるまで実装しない
- 将来の仮定に基づいた過剰な設計を避ける

## 命名規則

- 意味のある名前を使う（`data`や`temp`より具体的な名前）
- 一貫した命名規則を守る（camelCase, snake_case等）
- 略語は避け、読みやすさを優先する
- 関数名は動詞で始める（`getUserName`, `calculateTotal`）
- 真偽値は`is`, `has`, `can`で始める

## 関数設計

- 単一責任の原則（1つの関数は1つのことだけを行う）
- 関数は短く保つ（目安: 20-30行以内）
- 引数は少なく（3つ以下が理想）
- 副作用を最小限に

## エラーハンドリング

- エラーは早期に検出し、適切に処理する
- エラーメッセージは具体的で有用な情報を含める
- nullやundefinedのチェックを忘れない

## コメント

- コードで表現できることはコードで表現する
- 「なぜ」を説明するコメントを書く（「何を」ではなく）
- 古いコメントは削除または更新する

## テスト

- テスト可能なコードを書く
- 境界値とエッジケースをテストする
- テスト名は何をテストしているか明確に