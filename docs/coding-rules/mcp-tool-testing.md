---
description: MCPツールを作成・変更した時は、以下のプロセスに従うこと。
---

# MCP Tool Testing Requirements

MCPツールを作成・変更した時は、以下のプロセスに従うこと。

## 絶対禁止事項

**開発中のMCPツールがうまく動かない場合に手動で修正することは絶対にやめてください。**

MCPツールを使ってコードを修正する作業は、そのツール自体のテストを兼ねている。ツールが正常に動作しない場合は、ツールのバグを修正してから再度使用すること。

## 必須ワークフロー

MCPツールに不具合が発生した場合、必ず以下のステップを順番に実行すること：

1. **テストを書く/修正する**
   - 不具合の原因となっているケースのテストコードを書く
   - 既存のテストが不十分な場合は追加する

2. **テストが100%パスするまで修正する**
   - `pnpm --filter <package-name> test` でunit testを実行
   - integration testも含めてすべてパスすることを確認
   - バグが完全に解消されるまでこのステップを繰り返す

3. **ビルド確認**
   - `pnpm --filter <package-name> build` でビルド
   - TypeScriptエラーがないことを確認

4. **MCP再起動を依頼する**
   - ユーザーにMCP再起動を依頼する
   - 再起動しないと修正が反映されない

5. **実際にMCPを使ってテストする**
   - 再起動後、実際のユースケースでMCPツールを使用してテスト
   - 期待通りに動作することを確認

## テストの書き方

### ディレクトリ構造

```
packages/<mcp-name>/
├── src/
│   ├── __tests__/
│   │   ├── fixtures/       # テスト用ファイル
│   │   │   ├── sample.md
│   │   │   └── sample.adoc
│   │   └── integration.test.ts
│   └── handlers/
```

### テスト例

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { SomeHandler } from "../handlers/some.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

describe("Integration Tests", () => {
  let handler: SomeHandler;

  beforeAll(() => {
    handler = new SomeHandler();
  });

  it("should read file and return expected structure", async () => {
    const filePath = join(FIXTURES_DIR, "sample.md");
    const result = await handler.read(filePath);

    expect(result.filePath).toBe(filePath);
    expect(result.data).toBeDefined();
  });
});
```

## ファイル確認にはAST MCPツールを使用

コードやドキュメントファイルの内容確認には、各種AST MCPツールを活用すること：

- `mcp__ast-file-mcp__ast_read` - Markdown/AsciiDocファイルの読み取り
- `mcp__ast-file-mcp__read_directory` - ディレクトリ内の全ファイル概要
- `mcp__ast-typescript-mcp__ts_structure_read` - TypeScriptファイルの構造
- `mcp__ast-typescript-mcp__go_to_definition` - 定義へジャンプ
- `mcp__ast-typescript-mcp__find_references` - 参照の検索
