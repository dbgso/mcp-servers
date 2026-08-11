---
description: Dockerパッケージをghcr.ioに公開する手順
whenToUse:
  - Dockerパッケージ(python-diagrams-mcp等)をリリースしたい時
  - ghcr.ioに新バージョンを公開したい時
  - Changesetsを使ったDockerリリースフローを確認したい時
---

# Dockerパッケージのghcr.io公開手順

## 事前準備

不要。`GITHUB_TOKEN`で自動認証されます。

## リリース手順

### 1. Changesetを作成

```bash
pnpm changeset
```

- 対象パッケージを選択（例: python-diagrams-mcp）
- バージョンタイプを選択（patch/minor/major）
- 変更内容を記入

### 2. コミット・プッシュ

```bash
git add .changeset/*.md
git commit -m "chore: add changeset for python-diagrams-mcp"
git push
```

### 3. mainブランチにマージ

PRをmainにマージすると、Version PRが自動作成される。

### 4. Version PRをマージ

Version PRをマージすると以下が自動実行:

1. `package.json` の version 更新
2. `CHANGELOG.md` 生成
3. git tag 作成（例: `python-diagrams-mcp-v0.2.0`）
4. `docker-release.yml` 発火
5. ghcr.io にプッシュ

## フロー図

```
changeset add → PR → main merge
                        ↓
               Version PR 自動作成
                        ↓
               Version PR merge
                        ↓
              release.yml 実行
                   ├── npm publish (public packages)
                   └── git tag 作成 (Dockerパッケージ)
                              ↓
                    docker-release.yml 発火
                              ↓
                    ghcr.io push
```

## 公開後の確認

```bash
docker pull ghcr.io/dbgso/python-diagrams-mcp:latest
```

## 関連ファイル

- `.github/workflows/release.yml` - Changesets + タグ作成
- `.github/workflows/docker-release.yml` - Docker ビルド・プッシュ
- `.changeset/config.json` - privatePackages設定

## 背景

なぜDockerパッケージにpackage.jsonがあるのか知りたい場合:

```
# ADR一覧を確認
chain_query({ operation: "list", params: { type: "adr" } })

# 「DockerパッケージをChangesetsで管理する」を読む
chain_query({ operation: "read", params: { id: "01KJKTCC73F4XPRK750ZQHW216" } })
```
