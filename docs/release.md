---
description: Automated release setup using Changesets with npm OIDC provenance for secure, tokenless publishing.
whenToUse:
  - Setting up package release workflow
  - Creating changesets for version bumps
  - Adding a new package to npm registry
  - Understanding monorepo release strategy
---

# Release Configuration

Automated release setup using Changesets with npm OIDC provenance for secure, tokenless publishing.

## How It Works

```
1. Developer makes changes
   ↓
2. pnpm changeset
   → Select packages to version bump
   → Choose bump type (major/minor/patch)
   → Write summary
   ↓
3. PR includes .changeset/*.md files
   ↓
4. Merge to main
   ↓
5. GitHub Actions creates "Version Packages" PR
   → Updates CHANGELOG.md
   → Updates package.json versions
   ↓
6. Merge Version PR → npm publish
```

## Monorepo Release Strategy

### Important: Changeset vs Publish

| Function | Scope |
|----------|-------|
| **Version bump** | Only packages selected in changeset |
| **Publish** | All packages where local version ≠ npm version |

This means:
- Changeset controls **which packages get version bumps**
- Publish runs on **all packages not yet on npm with that version**

### To release only selected packages

All packages must be registered on npm first. Then:
1. Changeset bumps only selected packages
2. Only those packages have version mismatch with npm
3. Only those packages get published

### Adding a New Package to npm

1. **First-time manual publish:**
   ```bash
   pnpm --filter your-package publish --access public --auth-type=web
   ```

   Use pnpm, not `npm publish`. Dependencies here are written as `catalog:` and
   `workspace:`, and only `pnpm publish` / `pnpm pack` replace those with real
   versions — `npm publish` uploads the specifiers verbatim, producing a package
   nobody can install.

2. **Configure Trusted Publisher on npm:**
   - Go to https://www.npmjs.com/package/your-package/access
   - Add GitHub Actions as Trusted Publisher:
     - Organization: `dbgso`
     - Repository: `mcp-servers`
     - Workflow: `release.yml`

3. **Now changesets will handle future releases**

### Keeping a Package Private

Option 1: Add `"private": true` to package.json
```json
{
  "name": "my-package",
  "private": true
}
```

Option 2: Add to `.changeset/config.json` ignore list
```json
{
  "ignore": ["my-package"]
}
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm changeset` | Create a changeset for your changes |
| `pnpm version` | Apply changesets and update versions |
| `pnpm release` | Build and publish to npm |

## Creating a Changeset

```bash
$ pnpm changeset

🦋 Which packages would you like to include?
  ◯ git-repo-explorer-mcp
  ◉ interactive-instruction-mcp
  ◯ traceable-chain-mcp

🦋 Which packages should have a minor bump?
  ◉ interactive-instruction-mcp

🦋 Please enter a summary for this change:
  Added new validation feature
```

This creates `.changeset/<random-name>.md`:

```markdown
---
"interactive-instruction-mcp": minor
---

Added new validation feature
```

## NPM Authentication (OIDC Provenance)

We use npm's OIDC provenance feature instead of traditional NPM_TOKEN.

### Benefits

- No secrets to manage or rotate
- Cryptographic proof of build origin
- npm shows "Published with provenance" badge

### npm Side Configuration

The package must be configured on npm to allow publishing from GitHub Actions via OIDC.

## Configuration

### .changeset/config.json

```json
{
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch"
}
```

### GitHub Actions (release.yml)

Uses `changesets/action` to:
1. Detect pending changesets
2. Create "Version Packages" PR
3. Publish on merge
