---
id: 01KH429SFJ24HJD7JK6HZMXA3S
type: proposal
title: ULIDを使用
requires: 01KH428S2A01HN1NAAR4FK94RZ
created: 2026-02-10T15:21:43.666Z
updated: 2026-02-10T15:21:43.666Z
---

## 概要

ULID (Universally Unique Lexicographically Sortable Identifier) を使用する。

## メリット

- 時系列ソート可能（先頭48bitがタイムスタンプ）
- UUIDより短い（26文字 vs 36文字）
- 分散環境でも衝突なし
- Base32エンコードでURL安全

## デメリット

- UUIDより知名度が低い
- ライブラリの選択肢が少ない
