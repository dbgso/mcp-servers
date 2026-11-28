---
id: 01M8GM8GVCVFXVMF8GQQ3RRH4E
type: spec
title: ドリフト検査仕様（check / confirm / impact / bind_code）
requires: 01M8GM8GV3YVYR9SGWMCE3MSR3
created: 2026-11-28T08:27:31.564Z
updated: 2026-11-28T08:27:31.564Z
baseline:
  01M8GM8GV3YVYR9SGWMCE3MSR3:
    parent: d4007162650a355b
    self: 27ad589c1c8f7420
    at: 2026-11-28T08:27:31.564Z
---

## 承認時点の記録

各リンクは確認した時点の親と子の内容ハッシュ（title + 本文）を `baseline` に持つ。frontmatter はハッシュに含めない。

## check

| 種別 | 意味 |
|---|---|
| parent_changed | 親が確認後に変わった |
| self_changed | 自分が確認後に変わった |
| unreviewed_link | 一度も確認されていないリンク |
| code_changed / code_missing / code_unreviewed | 紐付けたコードが変わった / 消えた / 未確認 |
| unrealized / no_code（警告） | 下位に落ちていない決定 / コードのない implementation |

構造の検査（missing_parent, invalid_parent_type, cycle など）も含む。ドリフトした文書ごとに最上位までの祖先を `escalations` として返し、上位が全部確定しているものを `actionable` とする。

## confirm

祖先に未解決があれば拒否し、最上位の未解決を名指しする。コードはリンクより下なので、自分のリンクが未解決のうちはコードを確定できない。

## CLI

`traceable-chain check` はエラーがあれば exit 1、`--strict` で警告でも exit 1。
