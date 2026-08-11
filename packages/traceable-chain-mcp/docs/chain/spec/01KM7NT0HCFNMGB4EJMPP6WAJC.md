---
id: 01KM7NT0HCFNMGB4EJMPP6WAJC
type: spec
title: Query操作仕様
requires: 01KM7NM0AJHBXNE98J4VBX7DYX
created: 2026-03-21T07:47:26.892Z
updated: 2026-03-21T07:47:26.892Z
---

## 概要

読み取り専用操作。承認不要。

## read

IDでドキュメントを取得。

```
params: { id: string }
return: Document | error
```

## list

ドキュメント一覧を取得。

```
params: { type?: string }
return: { total: number, documents: DocumentSummary[] }
```

## trace

依存ツリーを辿る。

```
params: { id: string, direction?: "up" | "down" }
return: TraceNode (再帰的なツリー構造)
```

- `up`: 祖先を辿る (design → spec → requirement)
- `down`: 子孫を辿る (requirement → spec → design)

## validate

全ドキュメントの整合性チェック。

```
params: {}
return: { valid: boolean, errors: ValidationError[] }
```

チェック内容:
- 不明なtypeがないか
- 親が存在するか
- 親のtypeが正しいか
