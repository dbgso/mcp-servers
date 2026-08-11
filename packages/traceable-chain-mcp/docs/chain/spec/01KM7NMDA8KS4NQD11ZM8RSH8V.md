---
id: 01KM7NMDA8KS4NQD11ZM8RSH8V
type: spec
title: ドキュメント管理仕様
requires: 01KM7NM0AJHBXNE98J4VBX7DYX
created: 2026-03-21T07:44:23.369Z
updated: 2026-03-21T07:44:23.369Z
---

## 概要

ドキュメントのCRUD操作と依存関係管理の仕様。

## ドキュメント構造

各ドキュメントはMarkdownファイルとしてYAML frontmatterで保存:

```yaml
---
id: 01HQXK3V7M...  # ULID
type: spec
requires: 01HQXK2A8N...  # 親ドキュメントID
title: OAuth2 Integration Spec
created: 2024-01-15T10:30:00Z
updated: 2024-01-15T10:30:00Z
---

## Content here...
```

## 操作

### Query操作 (承認不要)
- **read**: IDでドキュメントを取得
- **list**: ドキュメント一覧 (typeでフィルタ可能)
- **trace**: 依存ツリーを辿る (up/down)
- **validate**: 全ドキュメントの整合性チェック

### Mutate操作 (承認必要)
- **create**: 新規作成 (非rootタイプは親必須)
- **update**: タイトル/コンテンツ更新
- **delete**: 削除 (依存があればエラー)
- **link**: 既存ドキュメントの親を変更
