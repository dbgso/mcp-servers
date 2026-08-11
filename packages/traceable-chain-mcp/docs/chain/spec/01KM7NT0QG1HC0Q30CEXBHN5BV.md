---
id: 01KM7NT0QG1HC0Q30CEXBHN5BV
type: spec
title: Mutate操作仕様
requires: 01KM7NM0AJHBXNE98J4VBX7DYX
created: 2026-03-21T07:47:27.088Z
updated: 2026-03-21T07:47:27.088Z
---

## 概要

書き込み操作。承認必要。

## create

新規ドキュメント作成。

```
params: {
  type: string,
  title: string,
  content: string,
  requires?: string  // 非rootタイプは必須
}
return: Document
```

制約:
- rootタイプ(requirement)は親を指定してはいけない
- 非rootタイプは親を指定しなければならない
- 親のタイプは設定で許可されたものでなければならない

## update

タイトル/コンテンツを更新。

```
params: { id: string, title?: string, content?: string }
return: Document
```

## delete

ドキュメントを削除。

```
params: { id: string }
return: success | error
```

制約:
- 依存するドキュメントがあれば削除不可

## link

既存ドキュメントの親を変更。

```
params: { id: string, parent_id: string }
return: Document
```

制約:
- 新しい親のタイプが許可されていること
- IDは保持される（再作成しない）
