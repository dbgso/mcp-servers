---
description: Claiming npm package names and configuring Trusted Publishing before the first automated release.
whenToUse:
  - Adding a new publishable package to the monorepo
  - Setting up npm publishing for the first time
  - Diagnosing a release that fails with 403 or E404 on publish
---

# npm bootstrap

## The problem

The release workflow publishes through OIDC Trusted Publishing, which npm only
lets you configure on a package that **already exists**. A brand-new package has
no page to configure, so its very first publish cannot use OIDC — a genuine
chicken-and-egg.

`scripts/bootstrap-npm-names.mjs` closes that gap once, with a short-lived
token, by publishing a `0.0.0` placeholder that contains no code.

A placeholder rather than the real first version, deliberately: publishing
`0.1.0` by hand leaves changesets with nothing to do, so the automated path
stays unexercised until some later bump. With a placeholder, the name exists,
the Trusted Publisher can be configured, and the real `0.1.0` goes out through
the normal workflow.

## Check first — this is read-only

```bash
node scripts/bootstrap-npm-names.mjs
```

It sorts every non-private package into three groups:

| group | meaning |
|---|---|
| `ours` | already on npm under our account — nothing to do |
| `free` | nobody has the name — the script can claim it |
| `TAKEN` | **on npm under someone else's account** |

`TAKEN` is a release blocker, and the reason this reports ownership rather than
mere existence. No token and no Trusted Publisher can publish to a name someone
else owns; the release would fail with 403 every time. Such a package needs a
scope (`@dbgso/…`) or a rename before it can ship.

The check exits non-zero when anything is `TAKEN`.

## Claim the free names

1. **Create a token.** npm → Access Tokens → Granular Access Token, permission
   *Read and write*, shortest workable expiry. This is the only step that needs
   a token at all.

2. **Run it:**
   ```bash
   NODE_AUTH_TOKEN=npm_xxx node scripts/bootstrap-npm-names.mjs --publish
   ```
   Without `--publish` it only reports; without `NODE_AUTH_TOKEN` it refuses to
   start rather than failing halfway through.

3. **Configure a Trusted Publisher** for each claimed name, at
   `https://www.npmjs.com/package/<name>/access`:
   - Organization: `dbgso`
   - Repository: `mcp-servers`
   - Workflow: `release.yml`

4. **Revoke the token.** Nothing uses it afterwards.

## Adding a package later

Same sequence, and the read-only check tells you whether it is needed: a new
package shows up as `free`, and one whose name is already taken shows up as
`TAKEN` before you have spent any time on it.
