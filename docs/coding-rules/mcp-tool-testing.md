---
description: MCPツール作成時のテスト要件。インテグレーションテストを必ず書き、vitestで確認後にMCP再起動を依頼する。
---

# MCP Tool Testing Requirements

MCPツールを作成・変更した時は、以下のプロセスに従うこと。

## 必須プロセス

1. **インテグレーションテストを書く**
   - 実際のユースケースに沿ったテストを必ず作成
   - ハンドラーの各メソッドをテスト
   - エッジケースも網羅

2. **vitestでテストを実行**
   - `pnpm --filter <package-name> test` でテストを実行
   - すべてのテストがパスすることを確認

3. **ビルド確認**
   - `pnpm --filter <package-name> build` でビルド
   - TypeScriptエラーがないことを確認

4. **MCP再起動依頼**
   - 上記すべてが完了してからMCP再起動を依頼

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
