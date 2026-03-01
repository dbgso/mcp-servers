---
id: 01KJKTCC73F4XPRK750ZQHW216
type: adr
title: DockerパッケージをChangesetsで管理する
requires: 01KJKTBFV6K7FKPNBDRQM3JAZG
created: 2026-03-01T04:26:52.515Z
updated: 2026-03-01T04:26:52.515Z
---

## 決定

DockerパッケージもChangesetsでバージョン管理する。

## 実装

### 1. Dockerパッケージにpackage.jsonを追加

```json
{
  "name": "python-diagrams-mcp",
  "version": "0.1.0",
  "private": true
}
```

`private: true`によりnpm publishはスキップされる。

### 2. Changesets設定でprivateパッケージを有効化

`.changeset/config.json`:
```json
{
  "privatePackages": {
    "version": true,
    "tag": true
  }
}
```

### 3. release.ymlでDockerタグを自動作成

Version PRマージ時に、Dockerfileを持つパッケージのタグを自動作成:

```yaml
- name: Create Docker release tags
  run: |
    for pkg_dir in packages/*/; do
      if [ -f "${pkg_dir}Dockerfile" ]; then
        name=$(basename "$pkg_dir")
        version=$(jq -r .version "${pkg_dir}package.json")
        tag="${name}-v${version}"
        git tag "$tag" && git push origin "$tag"
      fi
    done
```

### 4. docker-release.ymlがタグで発火

`*-mcp-v*`パターンのタグでDockerHubにプッシュ。

## フロー

```
pnpm changeset → Version PR → Merge
                                 ↓
                           npm publish (public)
                                 ↓
                           Dockerタグ作成 (private + Dockerfile)
                                 ↓
                           docker-release.yml発火
                                 ↓
                           DockerHub push
```

## 理由

### なぜ非JSパッケージにpackage.json？

Changesetsは`package.json`を前提とした設計:
- パッケージ検出はpackage.jsonの存在で判定
- versionフィールドを直接更新
- これはハードコードされた動作

Changesetsチームは[polyglotサポートは予定なし](https://github.com/changesets/changesets/issues/310)と明言。

## 参考

- [Changesets Discussion #1230: Docker images](https://github.com/changesets/changesets/discussions/1230)
- [Using Changesets in a Polyglot Monorepo](https://luke.hsiao.dev/blog/changesets-polyglot-monorepo/)
- [Changesets docs: Versioning Apps](https://github.com/changesets/changesets/blob/main/docs/versioning-apps.md)
