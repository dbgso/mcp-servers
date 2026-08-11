---
id: 01KK5EWX3R332MCBH0EPPZ5ABB
type: proposal
title: プレビュー段階で循環参照を警告
requires: 01KK5EWACTPANNNY76E2SRJDSK
created: 2026-03-08T00:52:30.968Z
updated: 2026-03-08T00:52:30.968Z
---

# 提案: プレビュー段階で循環参照を警告

## 概要

`link_add`操作のプレビュー出力時に、追加しようとしているリンクが循環参照を作成するかをチェックし、警告を表示する。

## 実装

### detectCircularReferencesメソッド

```typescript
private async detectCircularReferences(params: {
  reader: MarkdownReader;
  id: string;
  relatedDocs: string[];
}): Promise<string[]> {
  const warnings: string[] = [];
  for (const targetId of relatedDocs) {
    const targetContent = await reader.getDocumentContent(targetId);
    const targetFrontmatter = parseFrontmatter(targetContent);
    if (targetFrontmatter.relatedDocs?.includes(id)) {
      warnings.push(`${id} → ${targetId} → ${id}`);
    }
  }
  return warnings;
}
```

### プレビュー出力例

```
## Preview: Adding relatedDocs

**Document:** doc-a
**Adding:** doc-b

⚠️ **Warning: Circular reference detected**

Adding this link would create circular references:
- doc-a → doc-b → doc-a

Circular references are discouraged by lint rules.
```

## メリット

1. **事前検出**: confirmed前に問題に気づける
2. **lintとの整合性**: lintの`circular-reference`ルールと同じ問題を検出
3. **ブロックしない**: 警告のみで継続可能（強制しない）
