---
description: Configure authentication via OIDC (Trusted Publishers) from GitHub Actions to npm for publishing packages.
whenToUse:
  - Setting up GitHub Actions to publish npm packages
  - Configuring OIDC Trusted Publishers on npm
  - Troubleshooting npm publish authentication errors
  - Adding provenance to npm packages
---

# npm OIDC Trusted Publishers Configuration

Configure authentication via OIDC (Trusted Publishers) from GitHub Actions to npm for publishing packages.

## Required Configuration

### 1. npm Side: Trusted Publisher Settings

1. Go to Settings > Trusted Publishers for the package on npmjs.com
2. Configure the following:
   - Repository owner: `dbgso`
   - Repository name: `mcp-servers`
   - Workflow file name: `release.yml`
   - Environment: (leave empty)

### 2. GitHub Actions Workflow

```yaml
permissions:
  contents: write
  pull-requests: write
  id-token: write  # <- Required

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
          registry-url: 'https://registry.npmjs.org'  # <- Required

      - name: Update npm for OIDC support
        run: npm install -g npm@latest && npm --version  # <- Required

      - name: Publish to npm
        run: npm publish --provenance --access public  # <- --provenance Required
```

### 3. package.json

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/dbgso/mcp-servers.git",
    "directory": "packages/package-name"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  }
}
```

## Checklist

- [ ] `id-token: write` permission
- [ ] `registry-url` set in setup-node
- [ ] `npm install -g npm@latest` for latest npm
- [ ] `--provenance` flag with npm publish
- [ ] `repository` field matches the GitHub repository
- [ ] Trusted Publisher configured on npm side

## Common Errors

| Error | Cause |
|-------|-------|
| `ENEEDAUTH` | `registry-url` missing, or npm is outdated |
| `E404 Not found` | Trusted Publisher settings don't match workflow |
| `E422 repository.url` | `repository` field missing in package.json |

## Reference

- [npm Trusted Publishers](https://docs.npmjs.com/generating-provenance-statements)
