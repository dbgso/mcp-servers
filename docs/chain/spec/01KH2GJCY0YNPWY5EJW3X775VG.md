---
id: 01KH2GJCY0YNPWY5EJW3X775VG
type: spec
requires: 01KH2G9T4BYPTD1Q9TW7F79JWV
title: resolveRepo関数によるリポジトリ解決
created: 2026-02-10T00:52:36.929Z
updated: 2026-02-10T05:30:39.807Z
content: |-
  ## 概要

  ローカルとリモートリポジトリを統一的に扱うためのリポジトリ解決ロジック。

  ## 仕様

  ### 入力
  - `repo_url`: オプショナル。Git URL または省略

  ### 処理
  1. `repo_url`が省略された場合:
     - `git rev-parse --git-dir`で現在のディレクトリがGitリポジトリか確認
     - Gitリポジトリなら`process.cwd()`を返す
     - そうでなければエラー
  2. `repo_url`が指定された場合:
     - URLをハッシュ化してキャッシュパスを生成
     - キャッシュが存在すれば`git fetch`で更新
     - 存在しなければ`git clone --bare`

  ### 出力
  - リポジトリのローカルパス
filePath: docs/chain/spec/01KH2GJCY0YNPWY5EJW3X775VG.md
---

## 概要

ローカルとリモートリポジトリを統一的に扱うためのリポジトリ解決ロジック。

## 仕様

### 入力
- `repo_url`: オプショナル。Git URL または省略

### 処理
1. `repo_url`が省略された場合:
   - `git rev-parse --git-dir`で現在のディレクトリがGitリポジトリか確認
   - Gitリポジトリなら`process.cwd()`を返す
   - そうでなければエラー
2. `repo_url`が指定された場合:
   - URLをハッシュ化してキャッシュパスを生成
   - キャッシュが存在すれば`git fetch`で更新
   - 存在しなければ`git clone --bare`

### 出力
- リポジトリのローカルパス
