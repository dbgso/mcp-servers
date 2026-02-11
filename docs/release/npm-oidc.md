# npm OIDC Trusted Publishers 設定

GitHub ActionsからnpmにOIDC（Trusted Publishers）で認証してパッケージを公開する設定。

## 必要な設定

### 1. npm側: Trusted Publisher設定

1. npmjs.comでパッケージの Settings > Trusted Publishers
2. 以下を設定:
   - Repository owner: `dbgso`
   - Repository name: `mcp-servers`
   - Workflow file name: `release.yml`
   - Environment: (空欄)

### 2. GitHub Actions ワークフロー

```yaml
permissions:
  contents: write
  pull-requests: write
  id-token: write  # ← 必須

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'  # ← 必須

      - name: Update npm for OIDC support
        run: npm install -g npm@latest && npm --version  # ← 必須

      - name: Publish to npm
        run: npm publish --provenance --access public  # ← --provenance 必須
```

### 3. package.json

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/dbgso/mcp-servers.git",
    "directory": "packages/パッケージ名"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  }
}
```

## チェックリスト

- [ ] `id-token: write` 権限
- [ ] `registry-url` を setup-node で設定
- [ ] `npm install -g npm@latest` で最新npm
- [ ] `--provenance` フラグ付きで npm publish
- [ ] `repository` フィールドがGitHubリポジトリと一致
- [ ] npm側でTrusted Publisher設定済み

## よくあるエラー

| エラー | 原因 |
|--------|------|
| `ENEEDAUTH` | `registry-url` がない、または npm が古い |
| `E404 Not found` | Trusted Publisher設定がワークフローと不一致 |
| `E422 repository.url` | package.json に `repository` フィールドがない |

## 参考

- [npm Trusted Publishers](https://docs.npmjs.com/generating-provenance-statements)
