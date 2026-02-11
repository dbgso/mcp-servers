# Release Configuration

Automated release setup using Changesets with npm OIDC provenance for secure, tokenless publishing.

## How It Works

```
1. Developer makes changes
   ↓
2. pnpm changeset
   → Select packages
   → Choose bump type (major/minor/patch)
   → Write summary
   ↓
3. PR includes .changeset/*.md files
   ↓
4. Merge to master
   ↓
5. GitHub Actions creates "Version Packages" PR
   → Updates CHANGELOG.md
   → Updates package.json versions
   ↓
6. Merge Version PR → npm publish
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
  "baseBranch": "master",
  "updateInternalDependencies": "patch"
}
```

### GitHub Actions (release.yml)

Uses `changesets/action` to:
1. Detect pending changesets
2. Create "Version Packages" PR
3. Publish on merge
