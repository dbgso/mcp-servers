#!/usr/bin/env bash
# Put the real database drivers where the smoke tests can reach them.
#
# They are deliberately not workspace dependencies. `mcp-shared-db-postgres`
# and `mcp-shared-db-mysql` declare `pg` / `mysql2` as optional peers and load
# them with a dynamic import, and db-read-mcp's unit tests replace that import
# with `vi.doMock`. Installing the drivers into the workspace makes the mock
# resolve the real module instead of the fake, and those tests start dialling
# a database that is not there.
#
# So the drivers are installed for the smoke job only, straight into the root
# `node_modules` -- which is where the libraries' dynamic import looks, since
# resolution walks up from their own directory.
#
# Running this in a working copy will therefore break `pnpm test` for
# db-read-mcp until they are removed again -- and it is the drivers plus their
# dependencies, around two dozen directories, not just the two named below.
# `pnpm install` does not prune them, so `rm -rf node_modules && pnpm install`
# is the way back. CI throws the whole runner away, so it does not care.
#
# Verified not to collide: on a clean install this workspace's root
# node_modules holds only its own devDependencies, and none of them share a
# name with anything in the drivers' tree.
set -euo pipefail

PG_VERSION="${PG_VERSION:-8.13.1}"
MYSQL2_VERSION="${MYSQL2_VERSION:-3.11.5}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Installed from a scratch directory rather than in place: npm cannot parse
# this workspace's `catalog:` specifiers and refuses to run here at all.
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

( cd "$scratch" \
  && npm init -y >/dev/null \
  && npm install --no-audit --no-fund --loglevel=error \
       "pg@${PG_VERSION}" "mysql2@${MYSQL2_VERSION}" >/dev/null )

mkdir -p "$root/node_modules"
cp -R "$scratch/node_modules/." "$root/node_modules/"

echo "installed pg@${PG_VERSION} and mysql2@${MYSQL2_VERSION} into $root/node_modules"
