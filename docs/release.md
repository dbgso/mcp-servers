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

`private: true` is the only one of the two that stops a publish. `ignore`
controls versioning — `changeset publish` does not consult it, and will still
try to publish an ignored package whose version is ahead of the registry.

## Nothing publishes unless it is marked publishable

**Every package in this repository currently has `private: true`**, so a push to
`main` publishes nothing. That is the intended resting state: publishing is an
opt-in, per package, and removing `private` is the act of opting in.

It matters because `changeset publish` decides what to publish by comparing each
package's version against the registry, not by looking at which changesets were
merged. Without `private`, a package whose name is unregistered reads as
"needs publishing" on every run, and one push to `main` would publish the whole
set at once.

`private: true` therefore means one of two things here, and the difference is
intent rather than mechanism:

- the shared `mcp-shared*` libraries, and the Docker-distributed servers — never
  published to npm at all;
- a server that will be published, but is not ready yet.

### Releasing a package for the first time

1. Confirm the name is available and yours — `node scripts/bootstrap-npm-names.mjs`
   reports `ours` / `free` / `TAKEN`. A `TAKEN` name belongs to another npm
   account and can never be published to; it needs a rename or a scope first.
   This is not something a release can work around.
2. Claim the name and configure Trusted Publishing — see
   [npm bootstrap](./release/npm-bootstrap.md). Only the first publish of a
   package needs a token: npm can only attach a Trusted Publisher to a package
   that already exists.
3. Remove `private: true` from that package's `package.json`.
4. From then on it is the standard flow, and nothing here is special again: a
   changeset bumps it, the version PR merges, the release workflow publishes it.

Check the version before step 3 — removing `private` publishes whatever is in
`package.json` on the next push to `main`, not the next patch bump.

## Using a package privately via GitHub Packages

`.github/workflows/gpr-release.yml` publishes one package to GitHub Packages on
demand, independent of the npm release. It works for `private: true` packages
too — `private` is dropped only in the published copy, so the npm guard above
stays intact.

### Publish

```bash
gh workflow run gpr-release.yml -f package=ast-file-mcp            # private (default)
gh workflow run gpr-release.yml -f package=ast-file-mcp -f tag=dev -f visibility=private
```

- Name: `@dbgso/<package name>`, version `0.0.0-<tag>.<timestamp>.<sha>`, dist-tag `<tag>`
- The job summary shows the ready-to-run `npx` command and the visibility GitHub actually holds
- Visibility is decided by the first publish. **A public package can never be
  made private again**, so leave the default unless you mean it
- Packages that still list a `workspace:` package in `dependencies` (not bundled
  with tsup) are rejected: the published copy could not be installed

### Use

Reading GitHub Packages always needs a token with `read:packages`, even for
public packages. Add the scope once (interactive):

```bash
gh auth refresh -s read:packages
```

Run directly:

```bash
npx --yes \
  --@dbgso:registry=https://npm.pkg.github.com \
  --//npm.pkg.github.com/:_authToken=$(gh auth token) \
  @dbgso/ast-file-mcp@snapshot
```

Or configure `~/.npmrc` once and use plain `npx @dbgso/<name>@<tag>` (e.g. in an
MCP client config):

```ini
@dbgso:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
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
